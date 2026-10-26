import { getDb } from '../db/client.js';
import { batches, batchTrainers, users } from '../db/schema/index.js';
import { eq, inArray } from 'drizzle-orm';

export interface CreateBatchData {
  name: string;
  externalBatchId: string;
  startDate?: string;
}

export interface UpdateBatchData {
  name?: string;
  startDate?: string | null;
}

export class BatchModel {
  static async findAll(trainerId?: string) {
    const db = getDb();
    if (trainerId) {
      // Find batches where trainer is assigned
      const assigned = await db
        .select({
          id: batches.id,
          name: batches.name,
          externalBatchId: batches.externalBatchId,
          startDate: batches.startDate,
          createdAt: batches.createdAt,
        })
        .from(batches)
        .innerJoin(batchTrainers, eq(batches.id, batchTrainers.batchId))
        .where(eq(batchTrainers.userId, trainerId))
        .orderBy(batches.createdAt);
      return assigned;
    }

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

  static async findById(id: string) {
    const db = getDb();
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

  static async findByExternalId(externalBatchId: string) {
    const db = getDb();
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
      })
      .returning();
    return batch;
  }

  static async update(id: string, data: UpdateBatchData) {
    const db = getDb();
    const [batch] = await db
      .update(batches)
      .set(data)
      .where(eq(batches.id, id))
      .returning();
    return batch;
  }

  static async delete(id: string) {
    const db = getDb();
    const [deleted] = await db.delete(batches).where(eq(batches.id, id)).returning();
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
