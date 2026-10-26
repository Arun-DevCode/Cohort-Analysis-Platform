import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export class AppError extends Error {
  statusCode: number;
  code?: string;
  details?: any;

  constructor(message: string, statusCode = 500, code?: string, details?: any) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const code = err.code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'ERROR');

  logger.error(
    {
      err,
      method: req.method,
      url: req.originalUrl,
      statusCode,
    },
    err.message
  );

  res.status(statusCode).json({
    code,
    message: statusCode === 500 ? 'An unexpected internal error occurred' : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}
