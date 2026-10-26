import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../services/auth.service.js';
import { getDb } from '../db/client.js';
import { batchTrainers } from '../db/schema/index.js';
import { and, eq } from 'drizzle-orm';

export function authorize(roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        code: 'FORBIDDEN',
        message: `Forbidden: role '${req.user.role}' does not have sufficient permissions`,
      });
      return;
    }

    next();
  };
}

export function requireBatchAccess() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
      return;
    }

    // Admins and Managers have global read/access across all batches
    if (req.user.role === 'admin' || req.user.role === 'manager') {
      next();
      return;
    }

    const batchId = req.params.batchId || req.params.id;
    if (!batchId) {
      next();
      return;
    }

    try {
      const db = getDb();
      const assignment = await db.query.batchTrainers.findFirst({
        where: and(
          eq(batchTrainers.batchId, batchId),
          eq(batchTrainers.userId, req.user.userId)
        ),
      });

      if (!assignment) {
        res.status(403).json({
          code: 'FORBIDDEN',
          message: 'You are not assigned as a trainer for this batch',
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
