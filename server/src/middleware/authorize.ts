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

export { requireBatchAccess } from './requireBatchAccess.js';
export type { EntityType } from './requireBatchAccess.js';

