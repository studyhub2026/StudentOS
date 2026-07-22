import rateLimit, {
  ipKeyGenerator,
  type RateLimitRequestHandler,
} from 'express-rate-limit';
import { env } from '../config/env.js';
import { TooManyRequestsError } from '../utils/errors.js';

/**
 * Rate limits use the in-memory store, which is per-instance. A distributed
 * store (rate-limit-redis) is required before scaling beyond one backend node.
 */
function build(windowMs: number, max: number, message: string): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Authenticated users are limited per-account so shared IPs (school
    // networks, campus wifi) don't throttle each other. Anonymous traffic
    // falls back to IP — via ipKeyGenerator, which normalises IPv6 to its /64
    // so a single client cannot evade the limit by rotating addresses.
    keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
    skip: () => env.isTest,
    handler: (_req, _res, next) => {
      next(new TooManyRequestsError(message));
    },
  });
}

export const globalRateLimit = build(
  env.RATE_LIMIT_WINDOW_MS,
  env.RATE_LIMIT_MAX,
  'Too many requests, please slow down',
);

/** Tight limit on credential endpoints to blunt brute-force attempts. */
export const authRateLimit = build(
  15 * 60 * 1000,
  10,
  'Too many authentication attempts. Please try again in a few minutes.',
);

/** Gemini calls cost money and quota — limited far more aggressively. */
export const aiRateLimit = build(
  env.AI_RATE_LIMIT_WINDOW_MS,
  env.AI_RATE_LIMIT_MAX,
  'You are sending AI requests too quickly. Please wait a moment.',
);
