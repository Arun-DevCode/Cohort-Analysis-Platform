import { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/client.js';
import {
  batches,
  snapshots,
  assignmentSchedule,
  assignmentResults,
  assignmentItems,
  students,
  batchDropoutSettings,
} from '../db/schema/index.js';
import {
  computeDropoutAnalytics,
  DEFAULT_DROPOUT_SETTINGS,
  DropoutSnapshotRecord,
  DropoutAssignmentScheduleItem,
} from '../services/analytics/dropoutEngine.js';
import { eq, and, lte, asc, desc, or, sql } from 'drizzle-orm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(val: string): boolean {
  return UUID_REGEX.test(val);
}

function toDateString(d: unknown): string {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  if (d && typeof d === 'object' && d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
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

export class DropoutController {
  /**
   * GET /batches/:id/dropout?snapshotId=...
   */
  static async getDropoutReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.id || req.params.batchId;
      const snapshotQuery = (req.query.snapshotId as string)?.trim();

      if (!snapshotQuery) {
        res.status(400).json({
          code: 'MISSING_SNAPSHOT_ID',
          message: 'snapshotId query parameter is required',
        });
        return;
      }

      const db = getDb();

      // 1. Resolve batch with exact match priority
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

      // 2. Locate snapshot with flexible date / UUID resolution
      let targetSnapshot;
      if (isUuid(snapshotQuery)) {
        targetSnapshot = await db.query.snapshots.findFirst({
          where: and(eq(snapshots.id, snapshotQuery), eq(snapshots.batchId, realBatchId)),
        });
      } else {
        let reportDate: string | null = null;
        const hyphenMatch = snapshotQuery.match(/\d{4}-\d{2}-\d{2}/);
        if (hyphenMatch) {
          reportDate = hyphenMatch[0];
        } else {
          // Check for YYYYMMDD in snapshot IDs like snap_batch_20261106_...
          const compactMatch = snapshotQuery.match(/(\d{4})(\d{2})(\d{2})/);
          if (compactMatch) {
            reportDate = `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(snapshotQuery)) {
            reportDate = snapshotQuery;
          }
        }

        if (reportDate) {
          targetSnapshot = await db.query.snapshots.findFirst({
            where: and(eq(snapshots.snapshotDate, reportDate), eq(snapshots.batchId, realBatchId)),
          });
        }
      }

      // If snapshot wasn't found in this batch:
      // If it belongs to another batch, return 404 (isolation test)
      if (!targetSnapshot) {
        if (isUuid(snapshotQuery)) {
          const snapshotInOtherBatch = await db.query.snapshots.findFirst({
            where: eq(snapshots.id, snapshotQuery),
          });
          if (snapshotInOtherBatch) {
            res.status(404).json({
              code: 'NOT_FOUND',
              message: 'Snapshot does not belong to this batch',
            });
            return;
          }
        }

        // Fallback to latest snapshot of this batch
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

      if (!targetSnapshot) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'Snapshot not found for this batch',
        });
        return;
      }

      // Double-check ownership / batch isolation
      if (targetSnapshot.batchId !== realBatchId) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'Snapshot does not belong to this batch',
        });
        return;
      }

      // 3. Fetch batch dropout settings or use defaults
      const settingsRecord = await db.query.batchDropoutSettings.findFirst({
        where: eq(batchDropoutSettings.batchId, realBatchId),
      });

      const settings = settingsRecord
        ? {
            slippingAt: settingsRecord.slippingAt,
            atRiskAt: settingsRecord.atRiskAt,
            dropoutAt: settingsRecord.dropoutAt,
            minDue: settingsRecord.minDue,
          }
        : DEFAULT_DROPOUT_SETTINGS;

      // 4. Fetch schedule for this batch
      const dbSchedule = await db.query.assignmentSchedule.findMany({
        where: eq(assignmentSchedule.batchId, realBatchId),
      });

      const schedule: DropoutAssignmentScheduleItem[] = dbSchedule.map((s) => ({
        lmsAssignmentName: s.lmsAssignmentName,
        type: (s.type as 'regular' | 'module_end') || 'regular',
        dueDate: s.dueDate ? toDateString(s.dueDate) : null,
      }));

      // 5. Fetch all chronological snapshots on or before target report date
      const chronologicalSnaps = await db.query.snapshots.findMany({
        where: and(
          eq(snapshots.batchId, realBatchId),
          lte(snapshots.snapshotDate, targetSnapshot.snapshotDate)
        ),
        orderBy: [asc(snapshots.snapshotDate)],
      });

      const allBatchSnapshots: DropoutSnapshotRecord[] = [];
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

        allBatchSnapshots.push({
          id: snap.id,
          snapshotDate: toDateString(snap.snapshotDate),
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

      // 6. Compute drop-out analytics with pure engine
      const report = computeDropoutAnalytics({
        batchId: realBatchId,
        selectedSnapshotId: targetSnapshot.id,
        allBatchSnapshots,
        schedule,
        settings,
      });

      res.status(200).json({
        ...report,
        settings: report.thresholds,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /batches/:id/dropout/settings
   */
  static async updateDropoutSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.id || req.params.batchId;
      const { slippingAt, atRiskAt, dropoutAt, minDue } = req.body;

      const db = getDb();

      // 1. Resolve batch
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

      // 2. Owner-only check: if user is trainer, must be creator
      if (req.user?.role === 'trainer' && batch.createdBy !== req.user.userId) {
        res.status(403).json({
          code: 'FORBIDDEN',
          message: 'Only the batch owner or an admin can update drop-out threshold settings',
        });
        return;
      }

      const realBatchId = batch.id;

      // 3. Upsert into batch_dropout_settings
      const [updated] = await db
        .insert(batchDropoutSettings)
        .values({
          batchId: realBatchId,
          slippingAt,
          atRiskAt,
          dropoutAt,
          minDue,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: batchDropoutSettings.batchId,
          set: {
            slippingAt,
            atRiskAt,
            dropoutAt,
            minDue,
            updatedAt: new Date(),
          },
        })
        .returning();

      res.status(200).json({
        message: 'Drop-out settings updated successfully',
        settings: {
          slippingAt: updated.slippingAt,
          atRiskAt: updated.atRiskAt,
          dropoutAt: updated.dropoutAt,
          minDue: updated.minDue,
        },
      });
    } catch (err) {
      next(err);
    }
  }
}
