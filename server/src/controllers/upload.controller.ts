import { Request, Response, NextFunction } from 'express';
import { IngestionService } from '../services/ingestion/index.js';
import { UploadView } from '../views/upload.view.js';
import { getDb } from '../db/client.js';
import { batches, batchTrainers, uploads } from '../db/schema/index.js';
import { and, eq } from 'drizzle-orm';

export class UploadController {
  static async uploadReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({
          code: 'MISSING_FILE',
          message: 'An Excel file (.xlsx) is required in the file field',
        });
        return;
      }

      const rawBatchId = req.params.batchId || req.params.id;
      const snapshotDate =
        req.body.snapshotDate || new Date().toISOString().split('T')[0];
      const replace =
        req.body.replace === true ||
        req.body.replace === 'true' ||
        req.query.replace === 'true';

      const db = getDb();
      let targetBatch = await db.query.batches.findFirst({
        where: eq(batches.id, rawBatchId),
      });

      if (!targetBatch) {
        // Create new batch owned by req.user.userId
        const batchName = req.body.batchName || req.file.originalname.replace(/\.[^/.]+$/, '');
        const externalBatchId = req.body.externalBatchId || rawBatchId;
        const [newBatch] = await db
          .insert(batches)
          .values({
            id: rawBatchId.includes('-') && rawBatchId.length === 36 ? rawBatchId : undefined,
            name: batchName,
            externalBatchId,
            startDate: snapshotDate,
            createdBy: req.user!.userId,
          })
          .returning();
        targetBatch = newBatch;
      } else {
        // If batch already exists, verify trainer access
        if (req.user!.role === 'trainer') {
          const isCreator = targetBatch.createdBy === req.user!.userId;
          const isAssigned = await db.query.batchTrainers.findFirst({
            where: and(
              eq(batchTrainers.batchId, targetBatch.id),
              eq(batchTrainers.userId, req.user!.userId)
            ),
          });

          if (!isCreator && !isAssigned) {
            res.status(404).json({
              code: 'NOT_FOUND',
              message: 'Batch not found',
            });
            return;
          }
        }
      }

      const result = await IngestionService.ingest({
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname,
        batchId: targetBatch.id,
        snapshotDate,
        userId: req.user!.userId,
        replace,
      });

      if (result.status === 'failed') {
        res.status(422).json({
          code: 'INGESTION_FAILED',
          message: 'Workbook validation failed with blocking errors',
          uploadId: result.uploadId,
          errorReport: result.errorReport,
        });
        return;
      }

      res.status(201).json({
        message: 'Report uploaded and snapshot created successfully',
        uploadId: result.uploadId,
        snapshot: result.snapshot,
        errorReport: result.errorReport,
      });
    } catch (err: any) {
      if (err.message && err.message.includes('already exists')) {
        res.status(409).json({
          code: 'SNAPSHOT_EXISTS',
          message: err.message,
        });
        return;
      }
      next(err);
    }
  }

  static async getUploadStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const db = getDb();

      const upload = await db.query.uploads.findFirst({
        where: eq(uploads.id, id),
      });

      if (!upload) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'Upload not found',
        });
        return;
      }

      res.status(200).json({
        upload: UploadView.render(upload),
      });
    } catch (err) {
      next(err);
    }
  }
}
