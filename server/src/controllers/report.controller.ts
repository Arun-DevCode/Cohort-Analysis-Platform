import { Request, Response, NextFunction } from 'express';
import { ReportService } from '../services/report.service.js';

export class ReportController {
  static async exportBatchReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const snapshotId = req.query.snapshotId as string | undefined;
      const userId = req.user?.userId;

      const { buffer, filename } = await ReportService.generateBatchReport(id, {
        snapshotId,
        userId,
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(buffer);
    } catch (err) {
      next(err);
    }
  }
}
