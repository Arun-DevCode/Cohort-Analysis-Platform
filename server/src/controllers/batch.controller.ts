import { Request, Response, NextFunction } from 'express';
import { BatchModel } from '../models/batch.model.js';
import { BatchView } from '../views/batch.view.js';
import {
  CreateBatchInput,
  UpdateBatchInput,
  AssignTrainersInput,
} from '../validators/batch.validator.js';
import { AuditService } from '../services/audit.service.js';

export class BatchController {
  static async listBatches(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userScope = req.user ? { userId: req.user.userId, role: req.user.role } : undefined;
      const batches = await BatchModel.findAll(userScope);
      res.status(200).json({
        batches: BatchView.renderMany(batches),
      });
    } catch (err) {
      next(err);
    }
  }

  static async getBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const userScope = req.user ? { userId: req.user.userId, role: req.user.role } : undefined;
      const batch = await BatchModel.findById(id, userScope);

      if (!batch) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'Batch not found',
        });
        return;
      }

      res.status(200).json({
        batch: BatchView.render(batch),
      });
    } catch (err) {
      next(err);
    }
  }

  static async createBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = req.body as CreateBatchInput;
      const userScope = req.user ? { userId: req.user.userId, role: req.user.role } : undefined;

      const existing = await BatchModel.findByExternalId(data.externalBatchId, userScope);
      if (existing) {
        res.status(409).json({
          code: 'BATCH_EXISTS',
          message: `Batch with externalBatchId '${data.externalBatchId}' already exists`,
        });
        return;
      }

      const batch = await BatchModel.create({
        ...data,
        createdBy: req.user!.userId,
      });

      await AuditService.log({
        userId: req.user?.userId,
        action: 'create_batch',
        entity: 'batches',
        entityId: batch.id,
        meta: { name: batch.name, externalBatchId: batch.externalBatchId },
      });

      res.status(201).json({
        batch: BatchView.render(batch),
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const data = req.body as UpdateBatchInput;
      const userScope = req.user ? { userId: req.user.userId, role: req.user.role } : undefined;

      const existing = await BatchModel.findById(id, userScope);
      if (!existing) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'Batch not found',
        });
        return;
      }

      const updated = await BatchModel.update(id, data, userScope);

      await AuditService.log({
        userId: req.user?.userId,
        action: 'update_batch',
        entity: 'batches',
        entityId: id,
        meta: data,
      });

      res.status(200).json({
        batch: BatchView.render(updated),
      });
    } catch (err) {
      next(err);
    }
  }

  static async deleteBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const userScope = req.user ? { userId: req.user.userId, role: req.user.role } : undefined;

      const existing = await BatchModel.findById(id, userScope);
      if (!existing) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'Batch not found',
        });
        return;
      }

      await BatchModel.delete(id, userScope);

      await AuditService.log({
        userId: req.user?.userId,
        action: 'delete_batch',
        entity: 'batches',
        entityId: id,
        meta: { name: existing.name },
      });

      res.status(200).json({
        message: 'Batch deleted successfully',
      });
    } catch (err) {
      next(err);
    }
  }

  static async assignTrainers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { userIds } = req.body as AssignTrainersInput;
      const userScope = req.user ? { userId: req.user.userId, role: req.user.role } : undefined;

      const existing = await BatchModel.findById(id, userScope);
      if (!existing) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'Batch not found',
        });
        return;
      }

      await BatchModel.assignTrainers(id, userIds);
      const trainers = await BatchModel.getTrainers(id);

      await AuditService.log({
        userId: req.user?.userId,
        action: 'assign_trainers',
        entity: 'batches',
        entityId: id,
        meta: { userIds },
      });

      res.status(200).json({
        message: 'Trainers assigned successfully',
        trainers,
      });
    } catch (err) {
      next(err);
    }
  }
}
