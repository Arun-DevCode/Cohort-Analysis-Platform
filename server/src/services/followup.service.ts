import { getDb } from '../db/client.js';
import {
  followups,
  students,
  users,
  batchStudents,
  batchTrainers,
  snapshots,
} from '../db/schema/index.js';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import {
  CreateFollowupInput,
  QueryFollowupsInput,
  UpdateFollowupInput,
} from '../validators/followup.validator.js';
import { AppError } from '../middleware/errorHandler.js';
import { AuditService } from './audit.service.js';
import { batches } from '../db/schema/index.js';

export interface UserContext {
  userId: string;
  role: string;
}

export class FollowupService {
  static async createFollowup(
    input: CreateFollowupInput,
    user: UserContext
  ) {
    const db = getDb();

    // Verify student exists
    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.id, input.studentId))
      .limit(1);

    if (!student) {
      throw new AppError('Student not found', 404);
    }

    // If trainer, verify student is in trainer's accessible batches (created or assigned)
    if (user.role === 'trainer') {
      const accessibleBatches = await db
        .selectDistinct({ id: batches.id })
        .from(batches)
        .leftJoin(batchTrainers, eq(batches.id, batchTrainers.batchId))
        .where(
          or(
            eq(batches.createdBy, user.userId),
            eq(batchTrainers.userId, user.userId)
          )
        );

      const batchIds = accessibleBatches.map((b) => b.id);
      if (batchIds.length === 0) {
        throw new AppError('Student not found', 404);
      }

      const [inBatch] = await db
        .select()
        .from(batchStudents)
        .where(
          and(
            eq(batchStudents.studentId, input.studentId),
            inArray(batchStudents.batchId, batchIds)
          )
        )
        .limit(1);

      if (!inBatch) {
        throw new AppError('Student not found', 404);
      }
    }

    const [created] = await db
      .insert(followups)
      .values({
        studentId: input.studentId,
        snapshotId: input.snapshotId || null,
        ownerId: user.userId,
        note: input.note,
        status: input.status || 'open',
      })
      .returning();

    await AuditService.log({
      userId: user.userId,
      action: 'create_followup',
      entity: 'followups',
      entityId: created.id,
      meta: {
        studentId: input.studentId,
        status: created.status,
      },
    });

    return created;
  }

  static async listFollowups(
    query: QueryFollowupsInput,
    user: UserContext
  ) {
    const db = getDb();
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const offset = (page - 1) * pageSize;

    // Conditions
    const conditions = [];

    if (query.studentId) {
      conditions.push(eq(followups.studentId, query.studentId));
    }
    if (query.snapshotId) {
      conditions.push(eq(followups.snapshotId, query.snapshotId));
    }
    if (query.status) {
      conditions.push(eq(followups.status, query.status));
    }

    // Role check for trainers
    if (user.role === 'trainer') {
      const accessibleBatches = await db
        .selectDistinct({ id: batches.id })
        .from(batches)
        .leftJoin(batchTrainers, eq(batches.id, batchTrainers.batchId))
        .where(
          or(
            eq(batches.createdBy, user.userId),
            eq(batchTrainers.userId, user.userId)
          )
        );

      const batchIds = accessibleBatches.map((b) => b.id);
      if (batchIds.length === 0) {
        return { data: [], page, pageSize, total: 0 };
      }

      const eligibleStudents = await db
        .select({ studentId: batchStudents.studentId })
        .from(batchStudents)
        .where(inArray(batchStudents.batchId, batchIds));

      const studentIds = eligibleStudents.map((s) => s.studentId);
      if (studentIds.length === 0) {
        return { data: [], page, pageSize, total: 0 };
      }

      conditions.push(inArray(followups.studentId, studentIds));
    }

    // Filter by batch if specified
    if (query.batchId) {
      const batchStudentRows = await db
        .select({ studentId: batchStudents.studentId })
        .from(batchStudents)
        .where(eq(batchStudents.batchId, query.batchId));

      const bStudentIds = batchStudentRows.map((s) => s.studentId);
      if (bStudentIds.length === 0) {
        return { data: [], page, pageSize, total: 0 };
      }
      conditions.push(inArray(followups.studentId, bStudentIds));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        id: followups.id,
        studentId: followups.studentId,
        studentName: students.name,
        studentExternalId: students.externalStudentId,
        snapshotId: followups.snapshotId,
        snapshotDate: snapshots.snapshotDate,
        ownerId: followups.ownerId,
        ownerEmail: users.email,
        note: followups.note,
        status: followups.status,
        createdAt: followups.createdAt,
      })
      .from(followups)
      .innerJoin(students, eq(followups.studentId, students.id))
      .innerJoin(users, eq(followups.ownerId, users.id))
      .leftJoin(snapshots, eq(followups.snapshotId, snapshots.id))
      .where(whereClause)
      .orderBy(desc(followups.createdAt))
      .limit(pageSize)
      .offset(offset);

    return {
      data: rows,
      page,
      pageSize,
    };
  }

  static async updateFollowup(
    id: string,
    input: UpdateFollowupInput,
    user: UserContext
  ) {
    const db = getDb();

    const [existing] = await db
      .select()
      .from(followups)
      .where(eq(followups.id, id))
      .limit(1);

    if (!existing) {
      throw new AppError('Follow-up not found', 404);
    }

    if (user.role === 'trainer' && existing.ownerId !== user.userId) {
      throw new AppError('Follow-up not found', 404);
    }

    const updateData: Partial<typeof followups.$inferInsert> = {};
    if (input.note !== undefined) updateData.note = input.note;
    if (input.status !== undefined) updateData.status = input.status;

    const [updated] = await db
      .update(followups)
      .set(updateData)
      .where(eq(followups.id, id))
      .returning();

    await AuditService.log({
      userId: user.userId,
      action: 'update_followup',
      entity: 'followups',
      entityId: id,
      meta: updateData,
    });

    return updated;
  }

  static async deleteFollowup(id: string, user: UserContext) {
    const db = getDb();

    const [existing] = await db
      .select()
      .from(followups)
      .where(eq(followups.id, id))
      .limit(1);

    if (!existing) {
      throw new AppError('Follow-up not found', 404);
    }

    if (user.role !== 'admin' && existing.ownerId !== user.userId) {
      throw new AppError('Follow-up not found', 404);
    }

    await db.delete(followups).where(eq(followups.id, id));

    await AuditService.log({
      userId: user.userId,
      action: 'delete_followup',
      entity: 'followups',
      entityId: id,
    });

    return { message: 'Follow-up deleted successfully' };
  }
}
