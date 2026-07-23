import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Resolved relative to this module rather than cwd, so the backend loads the
// same .env whether started from the repo root or from backend/.
dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') });

/**
 * Validated, typed application configuration.
 *
 * The process exits on an invalid environment rather than starting in a
 * half-configured state — a missing JWT secret should never reach runtime.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().optional().or(z.literal('')),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  // Empty = host-only cookie on the API's own domain, which is what a
  // cross-site deployment (frontend and API on different domains) needs.
  COOKIE_DOMAIN: z.string().default(''),
  // 'none' is required when the frontend and API live on different sites, so
  // the browser sends the refresh cookie on cross-site fetches. 'none' is only
  // honoured together with Secure, which is on in production.
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  GEMINI_API_KEY: z.string().optional().or(z.literal('')),
  GEMINI_DEFAULT_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_PRO_MODEL: z.string().default('gemini-2.5-pro'),

  GOOGLE_CLIENT_ID: z.string().optional().or(z.literal('')),
  GOOGLE_CLIENT_SECRET: z.string().optional().or(z.literal('')),
  GITHUB_CLIENT_ID: z.string().optional().or(z.literal('')),
  GITHUB_CLIENT_SECRET: z.string().optional().or(z.literal('')),
  DISCORD_CLIENT_ID: z.string().optional().or(z.literal('')),
  DISCORD_CLIENT_SECRET: z.string().optional().or(z.literal('')),

  CLOUDINARY_CLOUD_NAME: z.string().optional().or(z.literal('')),
  CLOUDINARY_API_KEY: z.string().optional().or(z.literal('')),
  CLOUDINARY_API_SECRET: z.string().optional().or(z.literal('')),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AI_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
  AI_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isDevelopment: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
  /** Redis is optional — absence downgrades to in-process caching. */
  hasRedis: Boolean(raw.REDIS_URL),
  /** AI routes return 503 rather than failing opaquely when unconfigured. */
  hasGemini: Boolean(raw.GEMINI_API_KEY),
} as const;

export type Env = typeof env;
