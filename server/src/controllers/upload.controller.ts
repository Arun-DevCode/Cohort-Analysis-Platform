import { Request, Response, NextFunction } from 'express';
import { IngestionService } from '../services/ingestion/index.js';
import { UploadView } from '../views/upload.view.js';
import { getDb } from '../db/client.js';
import { uploads } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';

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

      const batchId = req.params.batchId || req.params.id;
      const snapshotDate =
        req.body.snapshotDate || new Date().toISOString().split('T')[0];
      const replace =
        req.body.replace === true ||
        req.body.replace === 'true' ||
        req.query.replace === 'true';

      const result = await IngestionService.ingest({
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname,
        batchId,
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
          code: 'UPLOAD_NOT_FOUND',
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
