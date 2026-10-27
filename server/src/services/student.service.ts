import { getDb } from '../db/client.js';
import {
  students,
  batches,
  batchStudents,
  batchTrainers,
  studentSnapshots,
  snapshots,
  assignmentItems,
  assignmentResults,
  weeklyConsumption,
  sessions,
  attendance,
  followups,
  users,
} from '../db/schema/index.js';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler.js';

export class StudentService {
  static async getStudentProfile(
    studentId: string,
    user: { userId: string; role: string },
    batchId?: string
  ) {
    const db = getDb();

    // 1. Fetch student
    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1);

    if (!student) {
      throw new AppError('Student not found', 404);
    }

    // 2. Fetch student's batches
    let studentBatchRows = await db
      .select({
        batchId: batches.id,
        name: batches.name,
        externalBatchId: batches.externalBatchId,
      })
      .from(batchStudents)
      .innerJoin(batches, eq(batchStudents.batchId, batches.id))
      .where(eq(batchStudents.studentId, studentId));

    const allBatchIds = studentBatchRows.map((b) => b.batchId);
    if (allBatchIds.length === 0) {
      throw new AppError('Student not found', 404);
    }

    if (batchId && !allBatchIds.includes(batchId)) {
      throw new AppError('Student does not belong to this batch', 404);
    }

    let accessibleBatchIds = allBatchIds;

    // 3. RBAC check for trainer / scoping to accessible batches
    if (user.role === 'trainer') {
      const accessibleBatches = await db
        .select({ id: batches.id })
        .from(batches)
        .leftJoin(batchTrainers, eq(batches.id, batchTrainers.batchId))
        .where(
          and(
            inArray(batches.id, allBatchIds),
            or(
              eq(batches.createdBy, user.userId),
              eq(batchTrainers.userId, user.userId)
            )
          )
        );

      accessibleBatchIds = accessibleBatches.map((b) => b.id);
      if (accessibleBatchIds.length === 0) {
        throw new AppError('Student not found', 404);
      }

      if (batchId && !accessibleBatchIds.includes(batchId)) {
        throw new AppError('Batch not found or not accessible', 404);
      }

      // Filter student's visible batches to only those this user can access
      studentBatchRows = studentBatchRows.filter((b) =>
        accessibleBatchIds.includes(b.batchId)
      );
    }

    if (batchId) {
      studentBatchRows = studentBatchRows.filter((b) => b.batchId === batchId);
    }

    // 4. Fetch longitudinal history across accessible snapshots only
    const rawHistoryRows = await db
      .select({
        snapshotId: snapshots.id,
        snapshotDate: snapshots.snapshotDate,
        batchId: snapshots.batchId,
        totalConsumptionPct: studentSnapshots.totalConsumptionPct,
        videoPct: studentSnapshots.videoPct,
        pdfPct: studentSnapshots.pdfPct,
        quizPct: studentSnapshots.quizPct,
        flashcardsPct: studentSnapshots.flashcardsPct,
        aiContentPct: studentSnapshots.aiContentPct,
        assignmentSubmissionPct: studentSnapshots.assignmentSubmissionPct,
        assignmentScorePct: studentSnapshots.assignmentScorePct,
        livePct: studentSnapshots.livePct,
        liveOrRecPct: studentSnapshots.liveOrRecPct,
        segment: studentSnapshots.segment,
        assignmentsTotal: studentSnapshots.assignmentsTotal,
        assignmentsSubmitted: studentSnapshots.assignmentsSubmitted,
        assignmentsDelayed: studentSnapshots.assignmentsDelayed,
        liveTotal: studentSnapshots.liveTotal,
        liveAttended: studentSnapshots.liveAttended,
      })
      .from(studentSnapshots)
      .innerJoin(snapshots, eq(studentSnapshots.snapshotId, snapshots.id))
      .where(
        and(
          eq(studentSnapshots.studentId, studentId),
          batchId
            ? eq(snapshots.batchId, batchId)
            : inArray(snapshots.batchId, accessibleBatchIds)
        )
      )
      .orderBy(snapshots.snapshotDate);

    const historyRows = rawHistoryRows.map((h) => ({
      ...h,
      totalConsumptionPct: parseFloat(h.totalConsumptionPct || '0'),
      videoPct: parseFloat(h.videoPct || '0'),
      pdfPct: parseFloat(h.pdfPct || '0'),
      quizPct: parseFloat(h.quizPct || '0'),
      flashcardsPct: parseFloat(h.flashcardsPct || '0'),
      aiContentPct: parseFloat(h.aiContentPct || '0'),
      assignmentSubmissionPct: parseFloat(h.assignmentSubmissionPct || '0'),
      assignmentScorePct: parseFloat(h.assignmentScorePct || '0'),
      livePct: parseFloat(h.livePct || '0'),
      liveOrRecPct: parseFloat(h.liveOrRecPct || '0'),
    }));

    const latestSnapshotMetrics = historyRows.length > 0 ? historyRows[historyRows.length - 1] : null;
    const latestSnapshotId = latestSnapshotMetrics?.snapshotId;

    // 5. Fetch details for latest snapshot
    let studentAssignments: any[] = [];
    let studentWeekly: any[] = [];
    let studentAttendance: any[] = [];

    if (latestSnapshotId) {
      // Assignments
      studentAssignments = await db
        .select({
          id: assignmentItems.id,
          name: assignmentItems.name,
          status: assignmentResults.status,
          score: assignmentResults.score,
          maxScore: assignmentResults.maxScore,
        })
        .from(assignmentResults)
        .innerJoin(assignmentItems, eq(assignmentResults.assignmentItemId, assignmentItems.id))
        .where(
          and(
            eq(assignmentResults.studentId, studentId),
            eq(assignmentItems.snapshotId, latestSnapshotId)
          )
        );

      // Weekly consumption
      studentWeekly = await db
        .select({
          weekNo: weeklyConsumption.weekNo,
          consumed: weeklyConsumption.consumed,
          total: weeklyConsumption.total,
        })
        .from(weeklyConsumption)
        .where(
          and(
            eq(weeklyConsumption.studentId, studentId),
            eq(weeklyConsumption.snapshotId, latestSnapshotId)
          )
        )
        .orderBy(weeklyConsumption.weekNo);

      // Attendance
      studentAttendance = await db
        .select({
          sessionId: sessions.id,
          title: sessions.title,
          sessionDate: sessions.sessionDate,
          liveStatus: attendance.liveStatus,
          liveOrRecStatus: attendance.liveOrRecStatus,
        })
        .from(attendance)
        .innerJoin(sessions, eq(attendance.sessionId, sessions.id))
        .where(
          and(
            eq(attendance.studentId, studentId),
            eq(sessions.snapshotId, latestSnapshotId)
          )
        )
        .orderBy(sessions.sessionDate);
    }

    // 6. Fetch follow-ups
    const studentFollowups = await db
      .select({
        id: followups.id,
        note: followups.note,
        status: followups.status,
        createdAt: followups.createdAt,
        ownerEmail: users.email,
        snapshotDate: snapshots.snapshotDate,
      })
      .from(followups)
      .innerJoin(users, eq(followups.ownerId, users.id))
      .leftJoin(snapshots, eq(followups.snapshotId, snapshots.id))
      .where(
        user.role === 'admin' || user.role === 'manager'
          ? eq(followups.studentId, studentId)
          : and(
              eq(followups.studentId, studentId),
              or(
                inArray(snapshots.batchId, accessibleBatchIds),
                eq(followups.ownerId, user.userId)
              )
            )
      )
      .orderBy(desc(followups.createdAt));

    return {
      student: {
        id: student.id,
        studentId: student.externalStudentId,
        name: student.name,
        phone: student.phoneE164,
        createdAt: student.createdAt,
      },
      batches: studentBatchRows,
      latestMetrics: latestSnapshotMetrics,
      history: historyRows,
      assignments: studentAssignments,
      weeklyConsumption: studentWeekly.map((w) => ({
        weekNo: w.weekNo,
        consumed: w.consumed,
        total: w.total,
        percentage: w.total > 0 ? Math.round((w.consumed / w.total) * 1000) / 10 : 0,
      })),
      attendance: studentAttendance,
      followups: studentFollowups,
    };
  }
}
