import { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/client.js';
import {
  batches,
  batchTrainers,
  batchStudents,
  uploads,
  snapshots,
  students,
  followups,
} from '../db/schema/index.js';
import { and, eq, inArray, or } from 'drizzle-orm';

export type EntityType = 'batch' | 'student' | 'snapshot' | 'upload' | 'followup';

export function requireBatchAccess(entityType: EntityType = 'batch') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
      return;
    }

    const { role, userId } = req.user;
    const targetId = req.params.batchId || req.params.id;

    if (!targetId) {
      next();
      return;
    }

    try {
      const db = getDb();
      let resolvedBatchIds: string[] = [];

      if (entityType === 'batch') {
        const batch = await db.query.batches.findFirst({
          where: eq(batches.id, targetId),
        });

        if (!batch) {
          // If this is a POST to create an upload and caller is trainer or admin,
          // let UploadController handle creating the batch
          if (req.method === 'POST' && req.path.endsWith('/uploads')) {
            next();
            return;
          }
          res.status(404).json({ code: 'NOT_FOUND', message: 'Batch not found' });
          return;
        }

        resolvedBatchIds = [batch.id];
      } else if (entityType === 'upload') {
        const upload = await db.query.uploads.findFirst({
          where: eq(uploads.id, targetId),
        });

        if (!upload) {
          res.status(404).json({ code: 'NOT_FOUND', message: 'Upload not found' });
          return;
        }

        resolvedBatchIds = [upload.batchId];
      } else if (entityType === 'snapshot') {
        const snapshot = await db.query.snapshots.findFirst({
          where: eq(snapshots.id, targetId),
        });

        if (!snapshot) {
          res.status(404).json({ code: 'NOT_FOUND', message: 'Snapshot not found' });
          return;
        }

        resolvedBatchIds = [snapshot.batchId];
      } else if (entityType === 'student') {
        const student = await db.query.students.findFirst({
          where: eq(students.id, targetId),
        });

        if (!student) {
          res.status(404).json({ code: 'NOT_FOUND', message: 'Student not found' });
          return;
        }

        const studentBatches = await db
          .select({ batchId: batchStudents.batchId })
          .from(batchStudents)
          .where(eq(batchStudents.studentId, targetId));

        resolvedBatchIds = studentBatches.map((b) => b.batchId);
        if (resolvedBatchIds.length === 0) {
          res.status(404).json({ code: 'NOT_FOUND', message: 'Student not found' });
          return;
        }
      } else if (entityType === 'followup') {
        const followup = await db.query.followups.findFirst({
          where: eq(followups.id, targetId),
        });

        if (!followup) {
          res.status(404).json({ code: 'NOT_FOUND', message: 'Follow-up not found' });
          return;
        }

        if (followup.snapshotId) {
          const snapshot = await db.query.snapshots.findFirst({
            where: eq(snapshots.id, followup.snapshotId),
          });
          if (snapshot) {
            resolvedBatchIds = [snapshot.batchId];
          }
        }

        if (resolvedBatchIds.length === 0) {
          const studentBatches = await db
            .select({ batchId: batchStudents.batchId })
            .from(batchStudents)
            .where(eq(batchStudents.studentId, followup.studentId));
          resolvedBatchIds = studentBatches.map((b) => b.batchId);
        }

        if (resolvedBatchIds.length === 0) {
          res.status(404).json({ code: 'NOT_FOUND', message: 'Follow-up not found' });
          return;
        }
      }

      // Role check:
      // Admin: full access to existing entities
      if (role === 'admin') {
        next();
        return;
      }

      // Manager: read-only access to all existing batches
      if (role === 'manager') {
        if (req.method !== 'GET') {
          res.status(403).json({
            code: 'FORBIDDEN',
            message: 'Managers have read-only access',
          });
          return;
        }
        next();
        return;
      }

      // Trainer: must be batch creator OR assigned in batchTrainers
      if (role === 'trainer') {
        const accessibleBatches = await db
          .select({ id: batches.id })
          .from(batches)
          .leftJoin(batchTrainers, eq(batches.id, batchTrainers.batchId))
          .where(
            and(
              inArray(batches.id, resolvedBatchIds),
              or(
                eq(batches.createdBy, userId),
                eq(batchTrainers.userId, userId)
              )
            )
          )
          .limit(1);

        if (accessibleBatches.length === 0) {
          res.status(404).json({
            code: 'NOT_FOUND',
            message: 'Resource not found',
          });
          return;
        }

        next();
        return;
      }

      res.status(404).json({ code: 'NOT_FOUND', message: 'Resource not found' });
    } catch (err) {
      next(err);
    }
  };
}
