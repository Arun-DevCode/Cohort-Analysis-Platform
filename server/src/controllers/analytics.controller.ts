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
      let snapshotIds: string[] = [];

      if (req.query.snapshots) {
        if (Array.isArray(req.query.snapshots)) {
          snapshotIds = (req.query.snapshots as string[]).map((s) => String(s).trim()).filter(Boolean);
        } else {
          snapshotIds = (req.query.snapshots as string)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        }
      } else if (req.query.from && req.query.to) {
        snapshotIds = [String(req.query.from).trim(), String(req.query.to).trim()];
      }

      if (snapshotIds.length < 2) {
        res.status(422).json({
          code: 'UNPROCESSABLE_ENTITY',
          message: 'Only reports of the same course with different dates can be compared',
        });
        return;
      }

      const tolerance = req.query.tolerance ? Number(req.query.tolerance) : 2;
      const comparison = await AnalyticsService.compareMultiSnapshots(
        batchId,
        snapshotIds,
        tolerance
      );

      res.status(200).json({
        batchId,
        snapshotIds,
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

  static async getStudents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchId = req.params.batchId || req.params.id;
      const snapshotId = req.query.snapshotId as string | undefined;

      const studentsData = await AnalyticsService.getBatchStudents(batchId, snapshotId);
      res.status(200).json(studentsData);
    } catch (err) {
      next(err);
    }
  }
}
