import { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/client.js';
import {
  batches,
  snapshots,
  assignmentItems,
  assignmentResults,
  students,
  assignmentSchedule,
  reportFiles,
} from '../db/schema/index.js';
import {
  parseRoadmapFromBuffer,
  normalizeAssignmentTitle,
  RoadmapItem,
} from '../services/roadmap/roadmapParser.js';
import {
  computeLateSubmissions,
  SnapshotInputData,
  ScheduleInputData,
} from '../services/analytics/lateSubmissionEngine.js';
import { getStorageService } from '../services/storage/index.js';
import { eq, and, or, lte, asc, desc, inArray, sql } from 'drizzle-orm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(val: string): boolean {
  return UUID_REGEX.test(val);
}

function findBatchWhere(batchId: string) {
  const isTargetUuid = isUuid(batchId);
  const clean = batchId.trim();
  const lower = clean.toLowerCase();
  const stripped = lower.replace(/^batch[-_]/i, '');
  return isTargetUuid
    ? or(
        eq(batches.id, clean),
        sql`lower(${batches.externalBatchId}) = ${lower}`,
        sql`lower(${batches.name}) = ${lower}`
      )
    : or(
        sql`lower(${batches.externalBatchId}) = ${lower}`,
        sql`lower(${batches.name}) = ${lower}`,
        sql`lower(${batches.externalBatchId}) = ${stripped}`,
        sql`lower(${batches.name}) = ${stripped}`,
        sql`lower(${batches.externalBatchId}) LIKE ${'%' + stripped + '%'}`,
        sql`lower(${batches.name}) LIKE ${'%' + stripped + '%'}`
      );
}

function addDaysToDateString(dateStr: string, days: number): string {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(Date.UTC(year, month - 1, day));
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  } catch {
    return dateStr;
  }
}

function toDateString(d: unknown): string {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  if (d && typeof d === 'object' && d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
}

export class ScheduleController {
  /**
   * Helper to compute string similarity between normalized titles
   */
  private static matchConfidence(lmsNorm: string, roadmapNorm: string): 'high' | 'medium' | 'low' | 'none' {
    if (!lmsNorm || !roadmapNorm) return 'none';
    if (lmsNorm === roadmapNorm) return 'high';
    if (lmsNorm.includes(roadmapNorm) || roadmapNorm.includes(lmsNorm)) return 'high';

    // Word overlap count
    const lmsWords = new Set(lmsNorm.split(' ').filter((w) => w.length > 2));
    const roadmapWords = new Set(roadmapNorm.split(' ').filter((w) => w.length > 2));
    let matchCount = 0;
    for (const w of lmsWords) {
      if (roadmapWords.has(w)) matchCount++;
    }

    if (matchCount >= 3 || (lmsWords.size > 0 && matchCount / lmsWords.size >= 0.6)) {
      return 'high';
    }
    if (matchCount >= 2 || (lmsWords.size > 0 && matchCount / lmsWords.size >= 0.4)) {
      return 'medium';
    }
    if (matchCount >= 1) {
      return 'low';
    }
    return 'none';
  }

  /**
   * GET /batches/:id/assignment-schedule
   */
  static async getSchedule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.id || req.params.batchId;
      const db = getDb();

      // 1. Fetch batch
      const cleanBatchId = batchId.trim();
      const lowerBatchId = cleanBatchId.toLowerCase();
      const strippedBatchId = lowerBatchId.replace(/^batch[-_]/i, '');
      const batch = await db.query.batches.findFirst({
        where: findBatchWhere(batchId),
        orderBy: [
          sql`CASE
            WHEN ${batches.id} = ${cleanBatchId} THEN 0
            WHEN lower(${batches.externalBatchId}) = ${lowerBatchId} THEN 1
            WHEN lower(${batches.name}) = ${lowerBatchId} THEN 2
            WHEN lower(${batches.externalBatchId}) = ${strippedBatchId} THEN 3
            WHEN lower(${batches.name}) = ${strippedBatchId} THEN 4
            ELSE 5
          END`,
          desc(batches.createdAt),
        ],
      });
      if (!batch) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Batch not found' });
        return;
      }
      const realBatchId = batch.id;

      // 2. Find all distinct assignment names from this batch's snapshots
      const batchSnapshots = await db.query.snapshots.findMany({
        where: eq(snapshots.batchId, realBatchId),
      });
      const snapIds = batchSnapshots.map((s) => s.id);

      let distinctLmsNames: string[] = [];
      if (snapIds.length > 0) {
        const items = await db
          .selectDistinct({ name: assignmentItems.name })
          .from(assignmentItems)
          .where(inArray(assignmentItems.snapshotId, snapIds));
        distinctLmsNames = items.map((i) => i.name.trim()).filter(Boolean);
      }

      // 3. Find current stored academic workbook for this batch
      const currentAcademicFile = await db.query.reportFiles.findFirst({
        where: and(
          eq(reportFiles.batchId, realBatchId),
          eq(reportFiles.kind, 'academic'),
          eq(reportFiles.isCurrent, true)
        ),
      });

      let roadmapItems: RoadmapItem[] = [];
      let minDate: string | null = null;
      let maxDate: string | null = null;

      if (currentAcademicFile) {
        try {
          const storage = getStorageService();
          const buffer = await storage.get(currentAcademicFile.objectKey);
          const allRoadmap = await parseRoadmapFromBuffer(buffer);
          roadmapItems = allRoadmap.filter((item) => item.kind === 'assignment' || item.kind === 'module_end');

          // Date range across all roadmap items
          const dates = allRoadmap.map((r) => r.date).filter(Boolean) as string[];
          if (dates.length > 0) {
            dates.sort();
            minDate = dates[0];
            maxDate = dates[dates.length - 1];
          }
        } catch (err: any) {
          // Log parsing error but don't crash schedule view
        }
      }

      // 4. Fetch existing schedule records from DB
      const existingSchedule = await db.query.assignmentSchedule.findMany({
        where: eq(assignmentSchedule.batchId, realBatchId),
      });
      const scheduleMap = new Map(existingSchedule.map((s) => [s.lmsAssignmentName.trim(), s]));

      // 5. Build auto-matched items
      const scheduleResults = distinctLmsNames.map((lmsName) => {
        const existing = scheduleMap.get(lmsName);
        const lmsNorm = normalizeAssignmentTitle(lmsName);

        // Auto-match best roadmap item
        let bestMatch: RoadmapItem | null = null;
        let bestConfidence: 'high' | 'medium' | 'low' | 'none' = 'none';

        if (existing?.roadmapKey) {
          bestMatch = roadmapItems.find((r) => r.id === existing.roadmapKey) || null;
          bestConfidence = bestMatch ? 'high' : 'none';
        } else {
          for (const item of roadmapItems) {
            const conf = ScheduleController.matchConfidence(lmsNorm, item.normalizedTitle);
            if (conf === 'high') {
              bestMatch = item;
              bestConfidence = 'high';
              break;
            } else if (conf === 'medium' && bestConfidence !== 'medium') {
              bestMatch = item;
              bestConfidence = 'medium';
            } else if (conf === 'low' && bestConfidence === 'none') {
              bestMatch = item;
              bestConfidence = 'low';
            }
          }
        }

        const isModuleEnd =
          lmsName.toLowerCase().includes('module end') ||
          lmsName.toLowerCase().includes('module-end') ||
          bestMatch?.kind === 'module_end';

        const type = existing?.type || (isModuleEnd ? 'module_end' : 'regular');
        const dueDate = existing?.dueDate ? toDateString(existing.dueDate) : null;
        const rawBatchStart = batch.startDate ? toDateString(batch.startDate) : null;
        const startDate = bestMatch?.date || rawBatchStart || null;
        let defaultDueDate: string | null = null;
        if (startDate) {
          const daysToAdd = type === 'module_end' ? 10 : 7;
          defaultDueDate = addDaysToDateString(startDate, daysToAdd);
        }
        const suggestedDueDate = defaultDueDate || bestMatch?.date || null;

        return {
          id: existing?.id || null,
          lmsAssignmentName: lmsName,
          roadmapKey: existing?.roadmapKey || bestMatch?.id || null,
          matchedRoadmapTitle: bestMatch?.topic || null,
          confidence: bestConfidence,
          type,
          dueDate,
          startDate,
          defaultDueDate,
          suggestedDueDate,
        };
      });

      res.status(200).json({
        batchId: realBatchId,
        batchStartDate: batch.startDate || null,
        hasAcademicFile: Boolean(currentAcademicFile),
        roadmapRange: { minDate, maxDate },
        roadmapItems: roadmapItems.map((r) => ({
          id: r.id,
          topic: r.topic,
          title: r.normalizedTitle,
          kind: r.kind,
          date: r.date,
          week: r.week,
          day: r.day,
        })),
        schedule: scheduleResults,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /batches/:id/assignment-schedule
   */
  static async updateSchedule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.id || req.params.batchId;
      const { schedule } = req.body;
      const db = getDb();

      // Verify batch exists
      const cleanUpdateBatchId = batchId.trim();
      const lowerUpdateBatchId = cleanUpdateBatchId.toLowerCase();
      const strippedUpdateBatchId = lowerUpdateBatchId.replace(/^batch[-_]/i, '');
      const batch = await db.query.batches.findFirst({
        where: findBatchWhere(batchId),
        orderBy: [
          sql`CASE
            WHEN ${batches.id} = ${cleanUpdateBatchId} THEN 0
            WHEN lower(${batches.externalBatchId}) = ${lowerUpdateBatchId} THEN 1
            WHEN lower(${batches.name}) = ${lowerUpdateBatchId} THEN 2
            WHEN lower(${batches.externalBatchId}) = ${strippedUpdateBatchId} THEN 3
            WHEN lower(${batches.name}) = ${strippedUpdateBatchId} THEN 4
            ELSE 5
          END`,
          desc(batches.createdAt),
        ],
      });
      if (!batch) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Batch not found' });
        return;
      }
      const realBatchId = batch.id;

      for (const item of schedule) {
        const cleanName = item.lmsAssignmentName.trim();
        const existing = await db.query.assignmentSchedule.findFirst({
          where: and(
            eq(assignmentSchedule.batchId, realBatchId),
            eq(assignmentSchedule.lmsAssignmentName, cleanName)
          ),
        });

        if (existing) {
          await db
            .update(assignmentSchedule)
            .set({
              roadmapKey: item.roadmapKey || null,
              type: item.type || 'regular',
              dueDate: item.dueDate || null,
              updatedAt: new Date(),
            })
            .where(eq(assignmentSchedule.id, existing.id));
        } else {
          await db.insert(assignmentSchedule).values({
            batchId: realBatchId,
            lmsAssignmentName: cleanName,
            roadmapKey: item.roadmapKey || null,
            type: item.type || 'regular',
            dueDate: item.dueDate || null,
          });
        }
      }

      const updated = await db.query.assignmentSchedule.findMany({
        where: eq(assignmentSchedule.batchId, realBatchId),
      });

      res.status(200).json({
        message: 'Assignment schedule updated successfully',
        schedule: updated,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /batches/:id/assignments/lateness?snapshotId=...
   */
  static async getLateness(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.id || req.params.batchId;
      const snapshotId = req.query.snapshotId as string;

      if (!snapshotId) {
        res.status(400).json({
          code: 'MISSING_SNAPSHOT_ID',
          message: 'snapshotId query parameter is required',
        });
        return;
      }

      const db = getDb();

      // Resolve batch
      const cleanLateBatchId = batchId.trim();
      const lowerLateBatchId = cleanLateBatchId.toLowerCase();
      const strippedLateBatchId = lowerLateBatchId.replace(/^batch[-_]/i, '');
      const batch = await db.query.batches.findFirst({
        where: findBatchWhere(batchId),
        orderBy: [
          sql`CASE
            WHEN ${batches.id} = ${cleanLateBatchId} THEN 0
            WHEN lower(${batches.externalBatchId}) = ${lowerLateBatchId} THEN 1
            WHEN lower(${batches.name}) = ${lowerLateBatchId} THEN 2
            WHEN lower(${batches.externalBatchId}) = ${strippedLateBatchId} THEN 3
            WHEN lower(${batches.name}) = ${strippedLateBatchId} THEN 4
            ELSE 5
          END`,
          desc(batches.createdAt),
        ],
      });
      if (!batch) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Batch not found' });
        return;
      }
      const realBatchId = batch.id;

      // 1. Verify snapshot belongs to this batch
      let targetSnapshot;
      if (isUuid(snapshotId)) {
        targetSnapshot = await db.query.snapshots.findFirst({
          where: and(eq(snapshots.id, snapshotId), eq(snapshots.batchId, realBatchId)),
        });
      } else {
        const dateMatch = snapshotId.match(/\d{4}-\d{2}-\d{2}/);
        const reportDate = dateMatch ? dateMatch[0] : snapshotId;
        targetSnapshot = await db.query.snapshots.findFirst({
          where: and(eq(snapshots.snapshotDate, reportDate), eq(snapshots.batchId, realBatchId)),
        });
      }

      // If still not found, fallback to latest snapshot of this batch
      if (!targetSnapshot) {
        targetSnapshot = await db.query.snapshots.findFirst({
          where: eq(snapshots.batchId, realBatchId),
          orderBy: [desc(snapshots.snapshotDate)],
        });
      }

      if (!targetSnapshot) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'Snapshot not found for this batch',
        });
        return;
      }

      // 2. Fetch all chronological snapshots on or before target report date
      const chronologicalSnaps = await db.query.snapshots.findMany({
        where: and(
          eq(snapshots.batchId, realBatchId),
          lte(snapshots.snapshotDate, targetSnapshot.snapshotDate)
        ),
        orderBy: [asc(snapshots.snapshotDate)],
      });

      // 3. For each snapshot, load all assignment results with student details
      const allBatchSnapshots: SnapshotInputData[] = [];

      for (const snap of chronologicalSnaps) {
        const results = await db
          .select({
            studentId: assignmentResults.studentId,
            studentName: students.name,
            phoneE164: students.phoneE164,
            assignmentName: assignmentItems.name,
            status: assignmentResults.status,
            score: assignmentResults.score,
          })
          .from(assignmentResults)
          .innerJoin(assignmentItems, eq(assignmentResults.assignmentItemId, assignmentItems.id))
          .innerJoin(students, eq(assignmentResults.studentId, students.id))
          .where(eq(assignmentItems.snapshotId, snap.id));

        const snapDateStr = toDateString(snap.snapshotDate);

        allBatchSnapshots.push({
          id: snap.id,
          snapshotDate: snapDateStr,
          assignments: results.map((r) => ({
            studentId: r.studentId,
            studentName: r.studentName,
            phoneE164: r.phoneE164,
            assignmentName: r.assignmentName,
            status: r.status,
            score: r.score ? parseFloat(r.score) : null,
          })),
        });
      }

      // 4. Fetch assignment schedule for this batch
      const dbSchedule = await db.query.assignmentSchedule.findMany({
        where: eq(assignmentSchedule.batchId, realBatchId),
      });

      const schedule: ScheduleInputData[] = dbSchedule.map((s) => ({
        lmsAssignmentName: s.lmsAssignmentName,
        roadmapKey: s.roadmapKey,
        type: (s.type as 'regular' | 'module_end') || 'regular',
        dueDate: s.dueDate ? toDateString(s.dueDate) : null,
      }));

      // 5. Compute lateness with pure engine
      const latenessReport = computeLateSubmissions({
        batchId: realBatchId,
        selectedSnapshotId: targetSnapshot.id,
        allBatchSnapshots,
        schedule,
      });

      res.status(200).json(latenessReport);
    } catch (err) {
      next(err);
    }
  }
}

