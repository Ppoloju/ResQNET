import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: config.rateLimitAuth,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too many auth attempts, slow down' },
});

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: config.rateLimitApi,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate limit exceeded' },
});
