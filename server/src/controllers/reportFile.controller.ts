import { Request, Response, NextFunction } from 'express';
import {
  ReportFileService,
  ValidationError,
  DuplicateFileError,
} from '../services/reportFile.service.js';
import { getDb } from '../db/client.js';
import { reportFiles, batches, batchTrainers } from '../db/schema/index.js';
import { eq, and, or, desc, sql } from 'drizzle-orm';
import { logger } from '../utils/logger.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(val: string): boolean {
  return UUID_REGEX.test(val);
}

export class ReportFileController {
  /**
   * Helper: check if authenticated user has access to the batch
   */
  private static async checkBatchAccess(batchId: string, user: { userId: string; role: string }): Promise<boolean> {
    if (user.role === 'admin') return true;

    const db = getDb();
    const isTargetUuid = isUuid(batchId);
    const clean = batchId.trim();
    const lower = clean.toLowerCase();
    const batch = await db.query.batches.findFirst({
      where: isTargetUuid
        ? or(eq(batches.id, clean), eq(batches.externalBatchId, clean), eq(batches.name, clean))
        : or(eq(batches.externalBatchId, clean), eq(batches.name, clean), sql`lower(${batches.name}) = ${lower}`, sql`lower(${batches.externalBatchId}) = ${lower}`),
      orderBy: [
        sql`CASE WHEN ${batches.id} = ${clean} THEN 0 WHEN lower(${batches.externalBatchId}) = ${lower} THEN 1 WHEN lower(${batches.name}) = ${lower} THEN 2 ELSE 3 END`,
        desc(batches.createdAt),
      ],
    });

    if (!batch) return false;

    if (batch.createdBy === user.userId) return true;

    if (user.role === 'trainer') {
      const assignment = await db.query.batchTrainers.findFirst({
        where: and(eq(batchTrainers.batchId, batch.id), eq(batchTrainers.userId, user.userId)),
      });
      return Boolean(assignment);
    }

    return false;
  }

  /**
   * POST /batches/:id/files/academic
   */
  static async uploadAcademic(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.id || req.params.batchId;
      if (!req.file) {
        res.status(400).json({
          code: 'MISSING_FILE',
          message: 'An Excel file (.xlsx) is required in the file field',
        });
        return;
      }

      const db = getDb();
      const isTargetUuid = isUuid(batchId);
      const clean = batchId.trim();
      const lower = clean.toLowerCase();
      const batch = await db.query.batches.findFirst({
        where: isTargetUuid
          ? or(eq(batches.id, clean), eq(batches.externalBatchId, clean), eq(batches.name, clean))
          : or(eq(batches.externalBatchId, clean), eq(batches.name, clean), sql`lower(${batches.name}) = ${lower}`, sql`lower(${batches.externalBatchId}) = ${lower}`),
        orderBy: [
          sql`CASE WHEN ${batches.id} = ${clean} THEN 0 WHEN lower(${batches.externalBatchId}) = ${lower} THEN 1 WHEN lower(${batches.name}) = ${lower} THEN 2 ELSE 3 END`,
          desc(batches.createdAt),
        ],
      });

      if (!batch) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'Batch not found',
        });
        return;
      }

      const result = await ReportFileService.uploadAcademicFile({
        batchId: batch.id,
        ownerId: batch.createdBy,
        userId: req.user!.userId,
        buffer: req.file.buffer,
        fileName: req.file.originalname,
      });

      res.status(201).json({
        message: 'Academic sheet uploaded successfully',
        file: result,
      });
    } catch (err: any) {
      if (err instanceof DuplicateFileError) {
        res.status(409).json({
          code: 'DUPLICATE_FILE',
          message: err.message,
          file: err.existingFile,
        });
        return;
      }

      if (err instanceof ValidationError) {
        const status =
          err.code === 'NOT_FOUND'
            ? 404
            : err.code === 'FILE_TOO_LARGE'
            ? 413
            : 422;
        res.status(status).json({
          code: err.code,
          message: err.message,
          details: err.details,
        });
        return;
      }

      next(err);
    }
  }

  /**
   * GET /batches/:id/files
   */
  static async listBatchFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.id || req.params.batchId;
      const db = getDb();
      const isTargetUuid = isUuid(batchId);
      const clean = batchId.trim();
      const lower = clean.toLowerCase();
      const batch = await db.query.batches.findFirst({
        where: isTargetUuid
          ? or(eq(batches.id, clean), eq(batches.externalBatchId, clean), eq(batches.name, clean))
          : or(eq(batches.externalBatchId, clean), eq(batches.name, clean), sql`lower(${batches.name}) = ${lower}`, sql`lower(${batches.externalBatchId}) = ${lower}`),
        orderBy: [
          sql`CASE WHEN ${batches.id} = ${clean} THEN 0 WHEN lower(${batches.externalBatchId}) = ${lower} THEN 1 WHEN lower(${batches.name}) = ${lower} THEN 2 ELSE 3 END`,
          desc(batches.createdAt),
        ],
      });

      if (!batch) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Batch not found' });
        return;
      }

      const files = await ReportFileService.listBatchFiles(batch.id);
      res.status(200).json({
        files,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /batches/:id/files/:fileId/current
   */
  static async setCurrentVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.id || req.params.batchId;
      const fileId = req.params.fileId;
      const db = getDb();
      const isTargetUuid = isUuid(batchId);
      const clean = batchId.trim();
      const lower = clean.toLowerCase();
      const batch = await db.query.batches.findFirst({
        where: isTargetUuid
          ? or(eq(batches.id, clean), eq(batches.externalBatchId, clean), eq(batches.name, clean))
          : or(eq(batches.externalBatchId, clean), eq(batches.name, clean), sql`lower(${batches.name}) = ${lower}`, sql`lower(${batches.externalBatchId}) = ${lower}`),
        orderBy: [
          sql`CASE WHEN ${batches.id} = ${clean} THEN 0 WHEN lower(${batches.externalBatchId}) = ${lower} THEN 1 WHEN lower(${batches.name}) = ${lower} THEN 2 ELSE 3 END`,
          desc(batches.createdAt),
        ],
      });

      if (!batch) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Batch not found' });
        return;
      }

      const updated = await ReportFileService.setCurrentVersion(batch.id, fileId);
      res.status(200).json({
        message: 'Academic version marked as current',
        file: updated,
      });
    } catch (err: any) {
      if (err instanceof ValidationError) {
        res.status(err.code === 'NOT_FOUND' ? 404 : 400).json({
          code: err.code,
          message: err.message,
        });
        return;
      }
      next(err);
    }
  }

  /**
   * GET /files/:fileId/download
   */
  static async downloadFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const fileId = req.params.fileId;
      const db = getDb();
      const record = await db.query.reportFiles.findFirst({
        where: eq(reportFiles.id, fileId),
      });

      if (!record) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'File not found',
        });
        return;
      }

      // Batch ownership check
      const hasAccess = await ReportFileController.checkBatchAccess(record.batchId, req.user!);
      if (!hasAccess) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'File not found',
        });
        return;
      }

      const fileData = await ReportFileService.getFileForDownload(fileId);
      if (!fileData) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'Stored file content not found',
        });
        return;
      }

      const safeFilename = encodeURIComponent(record.originalName);
      res.setHeader('Content-Type', record.contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${safeFilename}`);
      res.setHeader('Content-Length', record.sizeBytes);

      res.status(200).send(fileData.buffer);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /files/:fileId?confirm=true
   */
  static async deleteFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const fileId = req.params.fileId;
      const confirm = req.query.confirm === 'true';

      if (!confirm) {
        res.status(400).json({
          code: 'CONFIRMATION_REQUIRED',
          message: 'File deletion requires ?confirm=true query parameter',
        });
        return;
      }

      const db = getDb();
      const record = await db.query.reportFiles.findFirst({
        where: eq(reportFiles.id, fileId),
      });

      if (!record) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'File not found',
        });
        return;
      }

      // Batch ownership check
      const hasAccess = await ReportFileController.checkBatchAccess(record.batchId, req.user!);
      if (!hasAccess) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'File not found',
        });
        return;
      }

      await ReportFileService.deleteFile(fileId);

      res.status(200).json({
        message: 'File deleted successfully',
      });
    } catch (err) {
      next(err);
    }
  }
}

