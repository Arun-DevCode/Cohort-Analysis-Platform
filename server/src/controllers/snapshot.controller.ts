import { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/client.js';
import { snapshots } from '../db/schema/index.js';
import { SnapshotView } from '../views/snapshot.view.js';
import { eq, desc } from 'drizzle-orm';

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
}
