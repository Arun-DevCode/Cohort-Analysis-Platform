import rateLimit from 'express-rate-limit';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'TOO_MANY_REQUESTS',
    message: 'Too many authentication attempts, please try again later',
  },
});

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'TOO_MANY_REQUESTS',
    message: 'Rate limit exceeded, please slow down',
  },
});
