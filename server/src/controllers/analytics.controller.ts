import { Request, Response, NextFunction } from 'express';
import { AnalyticsService } from '../services/analytics/analytics.service.js';
import { exportAtRiskToCsv } from '../services/analytics/atRisk.js';
import { compareStrictSnapshots } from '../services/analytics/strictCompare.js';

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

      if (snapshotIds.length !== 2) {
        res.status(422).json({
          code: 'NOT_COMPARABLE',
          message:
            'Compare correct document: Exactly two reports from the same course must be selected.',
          shortReason: 'Exactly two reports from the same course must be selected.',
          checks: [
            {
              name: 'different_dates',
              passed: false,
              detail: 'Exactly two reports from the same course must be selected.',
            },
          ],
        });
        return;
      }

      const tolerance = req.query.tolerance ? Number(req.query.tolerance) : 2;
      const sameItems = req.query.sameItems === 'true';

      const comparison = await compareStrictSnapshots(batchId, snapshotIds[0], snapshotIds[1], {
        tolerance,
        sameItems,
      });

      if (!comparison.isComparable) {
        res.status(422).json({
          code: 'NOT_COMPARABLE',
          message: `Compare correct document: ${comparison.shortReason}`,
          shortReason: comparison.shortReason,
          checks: comparison.checks,
        });
        return;
      }

      const same = comparison.learnerComparisons?.filter((l) => l.status === 'Same') || [];
      const improved = comparison.learnerComparisons?.filter((l) => l.status === 'Improved') || [];
      const declined = comparison.learnerComparisons?.filter((l) => l.status === 'Declined') || [];

      res.status(200).json({
        ...comparison,
        comparisons: comparison.learnerComparisons,
        same,
        improved,
        declined,
        matrix: comparison.segmentMatrix?.matrix,
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
