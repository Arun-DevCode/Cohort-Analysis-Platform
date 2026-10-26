import { db } from './index';
import type {
  ParseResult,
  Snapshot,
  StudentSnapshot,
  AssignmentResult,
  WeeklyConsumption,
  Session,
  AttendanceRecord,
  Batch,
} from '@/types';

export interface SaveSnapshotOptions {
  batchId: string;
  batchName: string;
  batchCode?: string;
  snapshotDate: string; // YYYY-MM-DD
  parseResult: ParseResult;
  allowOverwrite?: boolean;
}

export async function checkExistingSnapshot(batchId: string, snapshotDate: string): Promise<Snapshot | undefined> {
  return await db.snapshots
    .where('[batchId+snapshotDate]')
    .equals([batchId, snapshotDate])
    .first();
}

export async function checkDuplicateFileHash(fileHash: string): Promise<Snapshot | undefined> {
  return await db.snapshots.where('fileHash').equals(fileHash).first();
}

export async function saveSnapshotTransaction({
  batchId,
  batchName,
  batchCode,
  snapshotDate,
  parseResult,
  allowOverwrite = false,
}: SaveSnapshotOptions): Promise<{ snapshotId: string; replaced: boolean }> {
  const existing = await checkExistingSnapshot(batchId, snapshotDate);
  if (existing && !allowOverwrite) {
    throw new Error(`A snapshot for date ${snapshotDate} already exists for this batch.`);
  }

  const snapshotId = existing ? existing.id : `snap_${batchId}_${snapshotDate.replace(/-/g, '')}_${Date.now()}`;
  let replaced = false;

  await db.transaction(
    'rw',
    [
      db.batches,
      db.students,
      db.snapshots,
      db.studentSnapshots,
      db.assignmentResults,
      db.weeklyConsumption,
      db.sessions,
      db.attendance,
    ],
    async () => {
      // 1. Ensure Batch exists and persist name and batch code
      const batchExists = await db.batches.get(batchId);
      if (!batchExists) {
        const newBatch: Batch = {
          id: batchId,
          name: batchName,
          externalBatchId: batchCode || undefined,
          createdAt: Date.now(),
        };
        await db.batches.put(newBatch);
      } else {
        await db.batches.update(batchId, {
          name: batchName,
          ...(batchCode ? { externalBatchId: batchCode } : {}),
        });
      }

      // 2. If overwriting existing snapshot, purge associated cascade
      if (existing) {
        replaced = true;
        await db.studentSnapshots.where('snapshotId').equals(snapshotId).delete();
        await db.assignmentResults.where('snapshotId').equals(snapshotId).delete();
        await db.weeklyConsumption.where('snapshotId').equals(snapshotId).delete();
        const existingSessions = await db.sessions.where('snapshotId').equals(snapshotId).toArray();
        for (const s of existingSessions) {
          await db.attendance.where('sessionId').equals(s.id).delete();
        }
        await db.sessions.where('snapshotId').equals(snapshotId).delete();
        await db.snapshots.delete(existing.id);
      }

      // 3. Upsert Students
      if (parseResult.students.length > 0) {
        await db.students.bulkPut(parseResult.students);
      }

      // 4. Insert Snapshot record
      const snapshotRecord: Snapshot = {
        id: snapshotId,
        batchId,
        snapshotDate,
        fileHash: parseResult.fileHash,
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
        fileName: parseResult.fileName,
      };
      await db.snapshots.put(snapshotRecord);

      // 5. Bulk put StudentSnapshots
      const studentSnapshotRecords: StudentSnapshot[] = parseResult.metrics.map((m) => ({
        id: `${snapshotId}_${m.studentId}`,
        snapshotId,
        studentId: m.studentId,
        metrics: m.metrics,
        segment: m.segment,
      }));
      await db.studentSnapshots.bulkPut(studentSnapshotRecords);

      // 6. Bulk put AssignmentResults
      const assignmentRecords: AssignmentResult[] = parseResult.assignmentResults.map((a, i) => ({
        id: `${snapshotId}_${a.studentId}_${i}`,
        snapshotId,
        studentId: a.studentId,
        assignmentName: a.assignmentName,
        status: a.status,
        score: a.score,
        maxScore: a.maxScore,
      }));
      await db.assignmentResults.bulkPut(assignmentRecords);

      // 7. Bulk put WeeklyConsumption
      const weeklyRecords: WeeklyConsumption[] = parseResult.weeklyConsumption.map((w) => ({
        id: `${snapshotId}_${w.studentId}_wk${w.weekNo}`,
        snapshotId,
        studentId: w.studentId,
        weekNo: w.weekNo,
        consumed: w.consumed,
        total: w.total,
      }));
      await db.weeklyConsumption.bulkPut(weeklyRecords);

      // 8. Bulk put Sessions and map session IDs
      const sessionMap = new Map<number, string>();
      const sessionRecords: Session[] = parseResult.sessions.map((s) => {
        const sId = `${snapshotId}_sess_${s.orderIndex}`;
        sessionMap.set(s.orderIndex, sId);
        return {
          id: sId,
          snapshotId,
          title: s.title,
          sessionDate: s.sessionDate,
          originalColumn: s.originalColumn,
          orderIndex: s.orderIndex,
        };
      });
      await db.sessions.bulkPut(sessionRecords);

      // 9. Bulk put Attendance
      const attendanceRecords: AttendanceRecord[] = parseResult.attendance.map((att, i) => {
        const sIdx = parseInt(att.sessionId.replace('sess_', ''), 10);
        const actualSessionId = sessionMap.get(sIdx) || att.sessionId;
        return {
          id: `${snapshotId}_att_${i}`,
          sessionId: actualSessionId,
          studentId: att.studentId,
          liveStatus: att.liveStatus,
          liveOrRecStatus: att.liveOrRecStatus,
        };
      });
      await db.attendance.bulkPut(attendanceRecords);
    }
  );

  return { snapshotId, replaced };
}
