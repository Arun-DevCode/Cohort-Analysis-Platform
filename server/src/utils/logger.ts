import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'headers.authorization',
      'password',
      'password_hash',
      'phone',
      'phone_e164',
      'name',
      '*.password',
      '*.phone',
      '*.name',
      'body.password',
      'body.phone',
    ],
    censor: '[REDACTED]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});
