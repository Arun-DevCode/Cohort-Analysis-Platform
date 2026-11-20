import { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/client.js';
import { snapshots, reportFiles } from '../db/schema/index.js';
import { SnapshotView } from '../views/snapshot.view.js';
import { eq, desc, and } from 'drizzle-orm';
import { ReportFileService } from '../services/reportFile.service.js';

export class SnapshotController {
  static async listSnapshots(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.batchId || req.params.id;
      const db = getDb();

      const list = await db.query.snapshots.findMany({
        where: eq(snapshots.batchId, batchId),
        orderBy: [desc(snapshots.snapshotDate)],
      });

      res.status(200).json({
        snapshots: SnapshotView.renderMany(list),
      });
    } catch (err) {
      next(err);
    }
  }

  static async deleteSnapshot(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.batchId || req.params.id;
      const snapshotId = req.params.snapshotId;
      const db = getDb();

      const snapshot = await db.query.snapshots.findFirst({
        where: and(eq(snapshots.id, snapshotId), eq(snapshots.batchId, batchId)),
      });

      if (!snapshot) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'Snapshot not found',
        });
        return;
      }

      // Deleting a snapshot removes its stored file(s)
      const linkedFiles = await db.query.reportFiles.findMany({
        where: eq(reportFiles.snapshotId, snapshotId),
      });

      for (const file of linkedFiles) {
        await ReportFileService.deleteFile(file.id);
      }

      await db.delete(snapshots).where(eq(snapshots.id, snapshotId));

      res.status(200).json({
        message: 'Snapshot and associated files deleted successfully',
      });
    } catch (err) {
      next(err);
    }
  }
}

