import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Authentication token required',
    });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = AuthService.verifyAccessToken(token);
    req.user = {
      ...payload,
      id: payload.userId || payload.id,
      userId: payload.userId || payload.id,
    };

    // Never accept userId, createdBy or ownerId from body, query or params
    if (req.body && typeof req.body === 'object') {
      delete (req.body as any).userId;
      delete (req.body as any).createdBy;
      delete (req.body as any).ownerId;
    }
    if (req.query && typeof req.query === 'object') {
      delete (req.query as any).userId;
      delete (req.query as any).createdBy;
      delete (req.query as any).ownerId;
    }

    next();
  } catch (err) {
    res.status(401).json({
      code: 'INVALID_TOKEN',
      message: 'Token is invalid or expired',
    });
  }
}
