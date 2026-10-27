import { getDb } from '../db/client.js';
import { batches, batchTrainers, users } from '../db/schema/index.js';
import { and, desc, eq, or } from 'drizzle-orm';

export interface CreateBatchData {
  name: string;
  externalBatchId: string;
  startDate?: string;
  createdBy: string;
}

export interface UpdateBatchData {
  name?: string;
  startDate?: string | null;
}

export interface UserScope {
  userId: string;
  role: string;
}

export class BatchModel {
  static async findAll(user?: UserScope) {
    const db = getDb();

    // Trainers only see batches they created or are assigned to
    if (user && user.role === 'trainer') {
      const assigned = await db
        .selectDistinct({
          id: batches.id,
          name: batches.name,
          externalBatchId: batches.externalBatchId,
          startDate: batches.startDate,
          createdBy: batches.createdBy,
          createdAt: batches.createdAt,
        })
        .from(batches)
        .leftJoin(batchTrainers, eq(batches.id, batchTrainers.batchId))
        .where(
          or(
            eq(batches.createdBy, user.userId),
            eq(batchTrainers.userId, user.userId)
          )
        )
        .orderBy(desc(batches.createdAt));

      return assigned;
    }

    // Admins and Managers read all batches
    return db.query.batches.findMany({
      orderBy: (batches, { desc }) => [desc(batches.createdAt)],
      with: {
        trainers: {
          with: {
            user: true,
          },
        },
      },
    });
  }

  static async findById(id: string, user?: UserScope) {
    const db = getDb();

    if (user && user.role === 'trainer') {
      const [batch] = await db
        .selectDistinct({
          id: batches.id,
          name: batches.name,
          externalBatchId: batches.externalBatchId,
          startDate: batches.startDate,
          createdBy: batches.createdBy,
          createdAt: batches.createdAt,
        })
        .from(batches)
        .leftJoin(batchTrainers, eq(batches.id, batchTrainers.batchId))
        .where(
          and(
            eq(batches.id, id),
            or(
              eq(batches.createdBy, user.userId),
              eq(batchTrainers.userId, user.userId)
            )
          )
        )
        .limit(1);

      return batch || null;
    }

    return db.query.batches.findFirst({
      where: eq(batches.id, id),
      with: {
        trainers: {
          with: {
            user: true,
          },
        },
      },
    });
  }

  static async findByExternalId(externalBatchId: string, user?: UserScope) {
    const db = getDb();

    if (user && user.role === 'trainer') {
      const [batch] = await db
        .selectDistinct({
          id: batches.id,
          name: batches.name,
          externalBatchId: batches.externalBatchId,
          startDate: batches.startDate,
          createdBy: batches.createdBy,
          createdAt: batches.createdAt,
        })
        .from(batches)
        .leftJoin(batchTrainers, eq(batches.id, batchTrainers.batchId))
        .where(
          and(
            eq(batches.externalBatchId, externalBatchId),
            or(
              eq(batches.createdBy, user.userId),
              eq(batchTrainers.userId, user.userId)
            )
          )
        )
        .limit(1);

      return batch || null;
    }

    return db.query.batches.findFirst({
      where: eq(batches.externalBatchId, externalBatchId),
    });
  }

  static async create(data: CreateBatchData) {
    const db = getDb();
    const [batch] = await db
      .insert(batches)
      .values({
        name: data.name,
        externalBatchId: data.externalBatchId,
        startDate: data.startDate || null,
        createdBy: data.createdBy,
      })
      .returning();
    return batch;
  }

  static async update(id: string, data: UpdateBatchData, user?: UserScope) {
    const db = getDb();
    const conditions = [eq(batches.id, id)];
    if (user && user.role !== 'admin') {
      conditions.push(eq(batches.createdBy, user.userId));
    }
    const [batch] = await db
      .update(batches)
      .set(data)
      .where(and(...conditions))
      .returning();
    return batch;
  }

  static async delete(id: string, user?: UserScope) {
    const db = getDb();
    const conditions = [eq(batches.id, id)];
    if (user && user.role !== 'admin') {
      conditions.push(eq(batches.createdBy, user.userId));
    }
    const [deleted] = await db.delete(batches).where(and(...conditions)).returning();
    return deleted;
  }

  static async assignTrainers(batchId: string, userIds: string[]) {
    const db = getDb();
    return db.transaction(async (tx) => {
      // Clear existing assignments for batch
      await tx.delete(batchTrainers).where(eq(batchTrainers.batchId, batchId));

      if (userIds.length > 0) {
        await tx.insert(batchTrainers).values(
          userIds.map((userId) => ({
            batchId,
            userId,
          }))
        );
      }

      return true;
    });
  }

  static async getTrainers(batchId: string) {
    const db = getDb();
    return db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
      })
      .from(users)
      .innerJoin(batchTrainers, eq(users.id, batchTrainers.userId))
      .where(eq(batchTrainers.batchId, batchId));
  }
}
