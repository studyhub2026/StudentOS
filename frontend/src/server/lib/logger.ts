import 'server-only';

/**
 * Minimal structured logger for serverless route handlers.
 *
 * Deliberately not pino: pino's pretty transport uses worker threads, which
 * are awkward and wasteful in short-lived serverless functions. Vercel already
 * captures stdout/stderr per invocation, so plain JSON lines are enough.
 * Secrets are redacted before anything is written.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const REDACT_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'refreshToken',
  'accessToken',
  'twoFactorSecret',
  'authorization',
  'cookie',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    output[key] = REDACT_KEYS.has(key) ? '[redacted]' : redact(val, depth + 1);
  }
  return output;
}

function emit(level: Level, context: unknown, message: string): void {
  if (level === 'debug' && process.env.NODE_ENV === 'production') return;

  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg: message,
    ...(context && typeof context === 'object' ? (redact(context) as object) : {}),
  });

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (context: unknown, message: string) => emit('debug', context, message),
  info: (context: unknown, message: string) => emit('info', context, message),
  warn: (context: unknown, message: string) => emit('warn', context, message),
  error: (context: unknown, message: string) => emit('error', context, message),
};
