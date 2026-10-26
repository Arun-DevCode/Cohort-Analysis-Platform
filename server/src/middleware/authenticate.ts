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
    req.user = payload;
    next();
  } catch (err) {
    res.status(401).json({
      code: 'INVALID_TOKEN',
      message: 'Token is invalid or expired',
    });
  }
}
