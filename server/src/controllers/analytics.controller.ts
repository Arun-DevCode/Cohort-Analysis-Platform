import { Request, Response, NextFunction } from 'express';
import { AnalyticsService } from '../services/analytics/analytics.service.js';
import { exportAtRiskToCsv } from '../services/analytics/atRisk.js';

export class AnalyticsController {
  static async getOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.batchId || req.params.id;
      const snapshotId = req.query.snapshotId as string | undefined;

      const data = await AnalyticsService.getBatchOverview(batchId, snapshotId);
      res.status(200).json(data);
    } catch (err) {
      next(err);
    }
  }

  static async compare(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.batchId || req.params.id;
      const fromSnapshotId = req.query.from as string;
      const toSnapshotId = req.query.to as string;

      if (!fromSnapshotId || !toSnapshotId) {
        res.status(400).json({
          code: 'MISSING_QUERY_PARAMS',
          message: "Both 'from' and 'to' snapshot IDs are required as query parameters",
        });
        return;
      }

      const tolerance = req.query.tolerance ? Number(req.query.tolerance) : 2;
      const comparison = await AnalyticsService.compareSnapshots(
        batchId,
        fromSnapshotId,
        toSnapshotId,
        tolerance
      );

      res.status(200).json({
        batchId,
        fromSnapshotId,
        toSnapshotId,
        ...comparison,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getAtRisk(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.batchId || req.params.id;
      const snapshotId = req.query.snapshotId as string | undefined;
      const format = req.query.format as string | undefined;

      const atRiskList = await AnalyticsService.getAtRiskStudents(batchId, snapshotId);

      if (format === 'csv') {
        const csv = exportAtRiskToCsv(atRiskList);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="at-risk-batch-${batchId}.csv"`);
        res.status(200).send(csv);
        return;
      }

      res.status(200).json({
        batchId,
        snapshotId,
        totalAtRisk: atRiskList.length,
        students: atRiskList,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.batchId || req.params.id;
      const snapshotId = req.query.snapshotId as string | undefined;

      const assignments = await AnalyticsService.getAssignmentStats(batchId, snapshotId);
      res.status(200).json({
        batchId,
        snapshotId,
        assignments,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getContent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.batchId || req.params.id;
      const snapshotId = req.query.snapshotId as string | undefined;

      const content = await AnalyticsService.getContentStats(batchId, snapshotId);
      res.status(200).json({
        batchId,
        ...content,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getAttendance(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.batchId || req.params.id;
      const snapshotId = req.query.snapshotId as string | undefined;

      const attendanceData = await AnalyticsService.getAttendanceStats(batchId, snapshotId);
      res.status(200).json({
        batchId,
        ...attendanceData,
      });
    } catch (err) {
      next(err);
    }
  }
}
