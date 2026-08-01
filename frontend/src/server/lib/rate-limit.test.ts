import { describe, expect, it } from 'vitest';
import { enforceRateLimit } from './rate-limit';
import { AppError } from './errors';

describe('enforceRateLimit', () => {
  it('permits requests up to the limit, then throws 429', () => {
    const opts = { bucket: `t-${Math.random()}`, limit: 3, windowMs: 60_000 };
    const id = 'user-1';

    expect(enforceRateLimit(id, opts).remaining).toBe(2);
    expect(enforceRateLimit(id, opts).remaining).toBe(1);
    expect(enforceRateLimit(id, opts).remaining).toBe(0);

    try {
      enforceRateLimit(id, opts);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(429);
    }
  });

  it('isolates identities within the same bucket', () => {
    const opts = { bucket: `t-${Math.random()}`, limit: 1, windowMs: 60_000 };
    expect(() => enforceRateLimit('a', opts)).not.toThrow();
    // A different identity has its own window.
    expect(() => enforceRateLimit('b', opts)).not.toThrow();
    // The first identity is now exhausted.
    expect(() => enforceRateLimit('a', opts)).toThrow();
  });

  it('resets after the window elapses', () => {
    const opts = { bucket: `t-${Math.random()}`, limit: 1, windowMs: -1 };
    // A window in the past is immediately expired, so every call is the first.
    expect(() => enforceRateLimit('c', opts)).not.toThrow();
    expect(() => enforceRateLimit('c', opts)).not.toThrow();
  });
});
