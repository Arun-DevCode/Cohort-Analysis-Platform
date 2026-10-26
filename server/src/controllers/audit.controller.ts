import { Request, Response, NextFunction } from 'express';
import { AuditService } from '../services/audit.service.js';

export class AuditController {
  static async listLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 20;
      const action = req.query.action as string | undefined;
      const entity = req.query.entity as string | undefined;

      const result = await AuditService.listLogs({ page, pageSize, action, entity });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
