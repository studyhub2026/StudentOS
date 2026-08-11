import 'server-only';
import { z } from 'zod';

/**
 * Server-only, validated configuration for the API route handlers.
 *
 * Next.js exposes non-`NEXT_PUBLIC_` variables to server code via
 * `process.env`. This module must never be imported from a client component —
 * the `server-only` guard turns any such import into a build error.
 *
 * Unlike the old Express server, the app and API share an origin, so there is
 * no separate API_URL/APP_URL split and no CORS: `APP_URL` is just this
 * deployment's own URL, used for OAuth redirects and email links.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  APP_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  COOKIE_DOMAIN: z.string().default(''),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  GEMINI_API_KEY: z.string().optional().or(z.literal('')),
  // "latest" aliases track the current stable model and avoid the new-user
  // restriction that now 404s pinned older versions like gemini-2.5-flash.
  GEMINI_DEFAULT_MODEL: z.string().default('gemini-flash-latest'),
  GEMINI_PRO_MODEL: z.string().default('gemini-pro-latest'),

  GOOGLE_CLIENT_ID: z.string().optional().or(z.literal('')),
  GOOGLE_CLIENT_SECRET: z.string().optional().or(z.literal('')),
  GITHUB_CLIENT_ID: z.string().optional().or(z.literal('')),
  GITHUB_CLIENT_SECRET: z.string().optional().or(z.literal('')),
  DISCORD_CLIENT_ID: z.string().optional().or(z.literal('')),
  DISCORD_CLIENT_SECRET: z.string().optional().or(z.literal('')),

  CLOUDINARY_CLOUD_NAME: z.string().optional().or(z.literal('')),
  CLOUDINARY_API_KEY: z.string().optional().or(z.literal('')),
  CLOUDINARY_API_SECRET: z.string().optional().or(z.literal('')),
  // Cloudinary's dashboard hands you a single URL; accept it as an alternative
  // to the three vars above so either style of configuration works.
  CLOUDINARY_URL: z.string().optional().or(z.literal('')),

  // Supabase Realtime powers live group chat. The URL and anon key are also
  // exposed to the client via NEXT_PUBLIC_ copies; the service role key stays
  // server-side for authorising broadcasts.
  SUPABASE_URL: z.string().optional().or(z.literal('')),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().or(z.literal('')),

  // Redis for BullMQ (LMS sync jobs). Optional — if unset, the queue is
  // disabled and syncs fall back to inline execution (dev fallback only).
  REDIS_URL: z.string().optional().or(z.literal('')),

  // LMS worker toggles. If false, the standalone `npm run worker` process
  // owns the queue; the web app only enqueues jobs. Defaults to true so a
  // single-process dev setup still runs jobs without an extra terminal.
  LMS_WORKER_IN_WEB: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  LMS_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),

  // Canvas LMS OAuth2. One developer key can serve many Canvas instances.
  CANVAS_CLIENT_ID: z.string().optional().or(z.literal('')),
  CANVAS_CLIENT_SECRET: z.string().optional().or(z.literal('')),

  // Moodle Web Services service shortname used for username/password token
  // exchange (POST {portal}/login/token.php?service=…). `moodle_mobile_app`
  // is enabled by default on virtually every Moodle install; institutions
  // that expose a different shortname can override this per deployment.
  MOODLE_SERVICE_SHORTNAME: z.string().default('moodle_mobile_app'),
});

const parsed = schema.safeParse(process.env);

// `next build` imports every route module to collect page data, which evaluates
// this file. The build never connects to the database or signs a token, so it
// must not require the real secrets — otherwise a first deploy can never build.
// During the build phase we fall back to placeholders and warn; at request time
// (any other phase) a missing secret still fails fast.
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

let raw: z.infer<typeof schema>;

if (parsed.success) {
  raw = parsed.data;
} else {
  const issues = parsed.error.issues
    .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  if (!isBuildPhase) {
    throw new Error(`Invalid server environment:\n${issues}`);
  }

  console.warn(
    `[env] Building with an incomplete environment; these are validated at runtime:\n${issues}`,
  );
  raw = schema.parse({
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://build:build@localhost:5432/build',
    JWT_ACCESS_SECRET:
      process.env.JWT_ACCESS_SECRET || 'build-time-placeholder-secret-unused-at-runtime',
    JWT_REFRESH_SECRET:
      process.env.JWT_REFRESH_SECRET || 'build-time-placeholder-secret-unused-at-runtime',
  });
}

/**
 * Cloudinary can be configured either as three separate vars or a single
 * `CLOUDINARY_URL` (`cloudinary://<api_key>:<api_secret>@<cloud_name>`). The
 * explicit vars win; otherwise the URL is parsed. Surrounding angle brackets —
 * a common copy/paste artefact from docs — are stripped from each part.
 */
function resolveCloudinary(r: z.infer<typeof schema>): {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
} {
  const strip = (value: string): string => value.trim().replace(/^<|>$/g, '');

  if (r.CLOUDINARY_CLOUD_NAME && r.CLOUDINARY_API_KEY && r.CLOUDINARY_API_SECRET) {
    return {
      cloudName: strip(r.CLOUDINARY_CLOUD_NAME),
      apiKey: strip(r.CLOUDINARY_API_KEY),
      apiSecret: strip(r.CLOUDINARY_API_SECRET),
    };
  }

  const url = r.CLOUDINARY_URL?.trim();
  if (url) {
    const match = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(url);
    if (match) {
      return { apiKey: strip(match[1]!), apiSecret: strip(match[2]!), cloudName: strip(match[3]!) };
    }
  }

  return { cloudName: '', apiKey: '', apiSecret: '' };
}

const cloudinary = resolveCloudinary(raw);

export const env = {
  ...raw,
  // Normalised so callers always read the three fields regardless of how
  // Cloudinary was configured.
  CLOUDINARY_CLOUD_NAME: cloudinary.cloudName,
  CLOUDINARY_API_KEY: cloudinary.apiKey,
  CLOUDINARY_API_SECRET: cloudinary.apiSecret,
  isProduction: raw.NODE_ENV === 'production',
  isDevelopment: raw.NODE_ENV === 'development',
  hasGemini: Boolean(raw.GEMINI_API_KEY),
  hasCloudinary: Boolean(cloudinary.cloudName && cloudinary.apiKey && cloudinary.apiSecret),
  hasSupabaseRealtime: Boolean(raw.SUPABASE_URL && raw.SUPABASE_SERVICE_ROLE_KEY),
  hasRedis: Boolean(raw.REDIS_URL),
  hasCanvasOAuth: Boolean(raw.CANVAS_CLIENT_ID && raw.CANVAS_CLIENT_SECRET),
} as const;

export type Env = typeof env;
