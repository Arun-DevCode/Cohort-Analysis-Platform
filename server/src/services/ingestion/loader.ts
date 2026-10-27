import { getDb } from '../../db/client.js';
import {
  batches,
  snapshots,
  studentSnapshots,
  students,
  batchStudents,
  assignmentItems,
  assignmentResults,
  weeklyConsumption,
  sessions,
  attendance,
  uploads,
  auditLogs,
} from '../../db/schema/index.js';
import { IngestionResult } from './identityResolver.js';
import { and, eq } from 'drizzle-orm';

export interface LoadSnapshotOptions {
  batchId: string;
  uploadId: string;
  snapshotDate: string; // YYYY-MM-DD
  userId: string;
  replace?: boolean;
}

export interface LoadSnapshotResult {
  snapshotId: string;
  batchId: string;
  snapshotDate: string;
  totalStudents: number;
  averages: IngestionResult['averages'];
}

export class SnapshotLoader {
  static async load(
    ingestion: IngestionResult,
    options: LoadSnapshotOptions
  ): Promise<LoadSnapshotResult> {
    const db = getDb();

    return db.transaction(async (tx) => {
      // 1. Check existing snapshot
      const existingSnapshot = await tx.query.snapshots.findFirst({
        where: and(
          eq(snapshots.batchId, options.batchId),
          eq(snapshots.snapshotDate, options.snapshotDate)
        ),
      });

      if (existingSnapshot) {
        if (!options.replace) {
          throw new Error(
            `Snapshot for batch and date ${options.snapshotDate} already exists. Pass replace=true to overwrite.`
          );
        }
        // Delete existing snapshot (cascade deletes all related fact tables)
        await tx.delete(snapshots).where(eq(snapshots.id, existingSnapshot.id));
      }

      // 2. Upsert Students (scoped to batch owner) and link to Batch
      const [batchRecord] = await tx
        .select({ createdBy: batches.createdBy })
        .from(batches)
        .where(eq(batches.id, options.batchId))
        .limit(1);

      const ownerId = batchRecord ? batchRecord.createdBy : options.userId;
      const studentIdMap = new Map<string, string>(); // externalStudentId -> uuid

      for (const st of ingestion.students) {
        let studentRecord = await tx.query.students.findFirst({
          where: and(
            eq(students.createdBy, ownerId),
            eq(students.externalStudentId, st.externalStudentId)
          ),
        });

        if (!studentRecord) {
          const [inserted] = await tx
            .insert(students)
            .values({
              createdBy: ownerId,
              externalStudentId: st.externalStudentId,
              name: st.name,
              phoneE164: st.phoneE164,
            })
            .returning();
          studentRecord = inserted;
        } else {
          // Update name/phone if changed
          const [updated] = await tx
            .update(students)
            .set({
              name: st.name,
              phoneE164: st.phoneE164,
            })
            .where(eq(students.id, studentRecord.id))
            .returning();
          studentRecord = updated;
        }

        studentIdMap.set(st.externalStudentId, studentRecord.id);

        // Link student to batch if not already linked
        const link = await tx.query.batchStudents.findFirst({
          where: and(
            eq(batchStudents.batchId, options.batchId),
            eq(batchStudents.studentId, studentRecord.id)
          ),
        });

        if (!link) {
          await tx.insert(batchStudents).values({
            batchId: options.batchId,
            studentId: studentRecord.id,
          });
        }
      }

      // 3. Insert Snapshot
      const [newSnapshot] = await tx
        .insert(snapshots)
        .values({
          batchId: options.batchId,
          uploadId: options.uploadId,
          snapshotDate: options.snapshotDate,
          parserVersion: 1,
        })
        .returning();

      const snapshotId = newSnapshot.id;

      // 4. Insert Student Snapshots
      if (ingestion.students.length > 0) {
        await tx.insert(studentSnapshots).values(
          ingestion.students.map((st) => ({
            snapshotId,
            studentId: studentIdMap.get(st.externalStudentId)!,
            totalConsumptionPct: String(st.totalConsumptionPct),
            videoPct: String(st.videoPct),
            pdfPct: String(st.pdfPct),
            quizPct: String(st.quizPct),
            flashcardsPct: String(st.flashcardsPct),
            aiContentPct: String(st.aiContentPct),
            assignmentSubmissionPct: String(st.assignmentSubmissionPct),
            assignmentScorePct: String(st.assignmentScorePct),
            livePct: String(st.livePct),
            liveOrRecPct: String(st.liveOrRecPct),
            assignmentsTotal: st.assignmentsTotal,
            assignmentsSubmitted: st.assignmentsSubmitted,
            assignmentsDelayed: st.assignmentsDelayed,
            liveTotal: st.liveTotal,
            liveAttended: st.liveAttended,
            segment: st.segment,
            raw: st.raw,
          }))
        );
      }

      // 5. Insert Assignment Items & Results
      const assignmentItemIdMap = new Map<string, string>(); // cleanName -> uuid

      if (ingestion.assignmentItems.length > 0) {
        const insertedItems = await tx
          .insert(assignmentItems)
          .values(
            ingestion.assignmentItems.map((item) => ({
              snapshotId,
              name: item.name,
            }))
          )
          .returning();

        insertedItems.forEach((item) => {
          assignmentItemIdMap.set(item.name, item.id);
        });

        if (ingestion.assignmentResults.length > 0) {
          await tx.insert(assignmentResults).values(
            ingestion.assignmentResults.map((res) => ({
              assignmentItemId: assignmentItemIdMap.get(res.assignmentName)!,
              studentId: studentIdMap.get(res.studentExternalId)!,
              status: res.status,
              score: res.score !== null ? String(res.score) : null,
              maxScore: res.maxScore !== null ? String(res.maxScore) : null,
            }))
          );
        }
      }

      // 6. Insert Weekly Consumption
      if (ingestion.weeklyConsumption.length > 0) {
        await tx.insert(weeklyConsumption).values(
          ingestion.weeklyConsumption.map((w) => ({
            snapshotId,
            studentId: studentIdMap.get(w.studentExternalId)!,
            weekNo: w.weekNo,
            consumed: w.consumed,
            total: w.total,
          }))
        );
      }

      // 7. Insert Sessions & Attendance
      const sessionIdMap = new Map<string, string>(); // sessionTitle -> uuid

      if (ingestion.sessions.length > 0) {
        const insertedSessions = await tx
          .insert(sessions)
          .values(
            ingestion.sessions.map((sess) => ({
              snapshotId,
              title: sess.title,
              sessionDate: sess.sessionDate,
            }))
          )
          .returning();

        insertedSessions.forEach((sess) => {
          sessionIdMap.set(sess.title, sess.id);
        });

        if (ingestion.attendance.length > 0) {
          await tx.insert(attendance).values(
            ingestion.attendance.map((att) => ({
              sessionId: sessionIdMap.get(att.sessionTitle)!,
              studentId: studentIdMap.get(att.studentExternalId)!,
              liveStatus: att.liveStatus,
              liveOrRecStatus: att.liveOrRecStatus,
            }))
          );
        }
      }

      // 8. Update Upload Status to 'done'
      await tx
        .update(uploads)
        .set({
          status: 'done',
          errorReport: {
            errors: ingestion.errors,
            warnings: ingestion.warnings,
            unmatchedRows: ingestion.unmatchedRows,
          },
        })
        .where(eq(uploads.id, options.uploadId));

      // 9. Write Audit Log
      await tx.insert(auditLogs).values({
        userId: options.userId,
        action: options.replace ? 'replace_snapshot' : 'create_snapshot',
        entity: 'snapshots',
        entityId: snapshotId,
        meta: {
          batchId: options.batchId,
          snapshotDate: options.snapshotDate,
          totalStudents: ingestion.totalStudents,
          averages: ingestion.averages,
        },
      });

      return {
        snapshotId,
        batchId: options.batchId,
        snapshotDate: options.snapshotDate,
        totalStudents: ingestion.totalStudents,
        averages: ingestion.averages,
      };
    });
  }
}
