import 'server-only';
import { AppError } from '@/server/lib/errors';

/**
 * A small in-memory sliding-window rate limiter.
 *
 * Keyed per user (or IP) per bucket, it protects the AI endpoints from a client
 * hammering generation and burning Gemini quota. It is process-local: on a
 * single long-lived Node server it is authoritative; on serverless it degrades
 * to per-instance limiting, which is still a useful backstop. A shared store
 * (Redis/Upstash) can be swapped in behind this same interface later.
 */

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

// Periodically drop expired windows so the map cannot grow unbounded. Unref so
// the timer never keeps the process alive on its own.
const SWEEP_MS = 5 * 60_000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, window] of buckets) {
    if (window.resetAt <= now) buckets.delete(key);
  }
}, SWEEP_MS);
if (typeof sweeper.unref === 'function') sweeper.unref();

export interface RateLimitOptions {
  /** Bucket name, e.g. "tutor-chat". Combined with the identity to form a key. */
  bucket: string;
  /** Max requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  remaining: number;
  resetAt: number;
}

/**
 * Records a hit against `identity` in `bucket`. Throws a 429 {@link AppError}
 * when the limit is exceeded; otherwise returns how many hits remain.
 */
export function enforceRateLimit(identity: string, options: RateLimitOptions): RateLimitResult {
  const key = `${options.bucket}:${identity}`;
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + options.windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { remaining: options.limit - 1, resetAt };
  }

  if (existing.count >= options.limit) {
    const retrySeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    throw new AppError(
      `You're sending requests too quickly. Try again in ${retrySeconds}s.`,
      429,
      'RATE_LIMITED',
      { retryAfterSeconds: retrySeconds },
    );
  }

  existing.count += 1;
  return { remaining: options.limit - existing.count, resetAt: existing.resetAt };
}

/** Sensible defaults for the tutor endpoints. */
export const TUTOR_LIMITS = {
  /** Generation (chat, quiz, flashcards, insights) is the expensive path. */
  generation: { limit: 30, windowMs: 60_000 },
  /** Reads and light writes. */
  standard: { limit: 120, windowMs: 60_000 },
} as const;
