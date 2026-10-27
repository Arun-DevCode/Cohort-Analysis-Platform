import pino, { type LoggerOptions } from 'pino';
import { createRequire } from 'module';
import { env } from '../config/env.js';

const require = createRequire(import.meta.url);

function canResolvePinoPretty(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

// Pretty print only in development IF pino-pretty is installed.
// In production or inside slim containers, default strictly to pure structured JSON.
const isPrettyEnabled = env.NODE_ENV === 'development' && canResolvePinoPretty();

const loggerOptions: LoggerOptions = {
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
  ...(isPrettyEnabled
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'pid,hostname',
            translateTime: 'SYS:standard',
          },
        },
      }
    : {}),
};

export const logger = pino(loggerOptions);
