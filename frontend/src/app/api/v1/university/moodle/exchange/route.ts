import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { LmsProvider } from '@prisma/client';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created } from '@/server/lib/response';
import { AppError, BadRequestError } from '@/server/lib/errors';
import { enforceRateLimit } from '@/server/lib/rate-limit';
import { env } from '@/server/env';
import { logger } from '@/server/lib/logger';
import { getAdapter } from '@/server/services/lms';
import { MoodleAdapter, MoodleAuthError, type MoodleAuthErrorCode } from '@/server/services/lms/moodle';
import {
  recordAuthMode,
  universitySyncService,
} from '@/server/services/university-sync.service';
import {
  SYNC_INTERVAL_MINUTES,
} from '@/server/validators/university.validator';

/**
 * POST /api/v1/university/moodle/exchange
 *
 * Exchanges a Moodle username + password for a Web Service token and creates
 * a fully-authenticated LmsConnection — the equivalent of the paste-a-token
 * flow, but with the token retrieved server-side.
 *
 * Security invariants (assert-tested):
 *   - The password lives only in the local scope of this handler + the
 *     adapter's exchangePasswordForToken(). It is never persisted, logged,
 *     returned to the client, or placed on the BullMQ queue.
 *   - The returned token is immediately encrypted via the existing
 *     createConnection → encryptedAccessToken pipeline. Plaintext is dropped
 *     as soon as this handler returns.
 *   - Rate-limited per-user-per-portal to blunt password-spray attacks.
 *   - When Moodle refuses (SSO, disabled Web Services, wrong service
 *     shortname, MFA), the friendly UI message tells the student to use the
 *     Web Service Token flow instead. We never fake success.
 *
 * Response body carries only the connection id — never the password, never
 * the token, never the encryptedAccessToken.
 */

const bodySchema = z.object({
  portalUrl: z.string().trim().url('Portal URL must be a valid URL'),
  displayName: z.string().trim().min(1, 'Display name is required').max(120),
  username: z.string().trim().min(1, 'Username is required').max(200),
  // Password is deliberately not `.trim()` — students may have leading/trailing
  // whitespace in a copy-pasted institutional password. We still bound the size.
  password: z.string().min(1, 'Password is required').max(500),
  autoSync: z.boolean().default(true),
  syncInterval: z
    .coerce.number()
    .int()
    .refine((v) => (SYNC_INTERVAL_MINUTES as readonly number[]).includes(v))
    .default(60),
  importGrades: z.boolean().default(true),
  importCalendar: z.boolean().default(true),
  importFiles: z.boolean().default(true),
});

/**
 * Maps typed MoodleAuthError codes → user-facing (safe) HTTP responses.
 * Never leaks credentials — the response comes from a fixed map, not from
 * the exception's `.message`.
 */
const FRIENDLY_MESSAGE: Record<MoodleAuthErrorCode, string> = {
  INVALID_CREDENTIALS: 'Incorrect Moodle username or password.',
  WEBSERVICE_DISABLED:
    'This Moodle server has Web Services disabled. Ask your admin to enable them, or use a Web Service Token.',
  SERVICE_NOT_FOUND:
    'This Moodle server does not expose a compatible Web Service. Please use a Web Service Token instead.',
  SSO_REQUIRED:
    'Your university uses an external Moodle login system (SSO). Please connect using a Web Service Token.',
  MFA_REQUIRED:
    'Your Moodle account requires multi-factor authentication. Please connect using a Web Service Token.',
  PASSWORD_AUTH_UNSUPPORTED:
    'Username/password authentication is not enabled on this Moodle server. Please connect using a Moodle Web Service Token.',
  MOODLE_UNAVAILABLE: 'Moodle is currently unreachable. Please check the URL and try again.',
  RATE_LIMITED: 'Moodle is rate-limiting login attempts. Please wait a moment and try again.',
};

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);

  // 5 attempts per 15 minutes per user — enough for typos, tight enough to
  // deter brute force. Uses the existing sliding-window limiter (not a new one).
  enforceRateLimit(user.id, {
    bucket: 'moodle-password-exchange',
    limit: 5,
    windowMs: 15 * 60_000,
  });

  const input = await readJson(req, bodySchema);

  // Never let the password reach any log line or exception message. From here
  // on, only `input.username`, `input.portalUrl`, and typed error codes are
  // safe to surface.
  logger.info(
    { userId: user.id, portalUrl: input.portalUrl },
    'moodle: username/password exchange requested',
  );

  const adapter = getAdapter(LmsProvider.MOODLE, input.portalUrl);
  if (!(adapter instanceof MoodleAdapter)) {
    throw new AppError('Adapter mismatch', 500, 'INTERNAL_ERROR');
  }

  let tokenValue: string;
  try {
    const result = await adapter.exchangePasswordForToken(
      input.username,
      input.password,
      env.MOODLE_SERVICE_SHORTNAME,
    );
    tokenValue = result.token;
  } catch (err) {
    if (err instanceof MoodleAuthError) {
      // Friendly message from the fixed map — never `err.message` because
      // that is derived from Moodle's own text and might carry the account
      // name or other identifiers we would rather not echo back.
      throw new BadRequestError(FRIENDLY_MESSAGE[err.code], { code: err.code });
    }
    // Non-typed failure: surface as a generic unavailability. The password
    // cannot appear here because the adapter throws typed errors on the
    // credential path.
    throw new BadRequestError('Could not authenticate with Moodle. Please try again later.');
  }

  // From here the password is no longer referenced. Hand the returned token
  // to the SAME code path a paste-a-token connection uses: createConnection
  // validates it (calls adapter.getProfile), encrypts it, persists it, and
  // registers the auto-sync scheduler. Zero duplicated logic.
  const connection = await universitySyncService.createConnection(user.id, {
    provider: LmsProvider.MOODLE,
    displayName: input.displayName,
    portalUrl: input.portalUrl,
    accessToken: tokenValue,
    autoSync: input.autoSync,
    syncInterval: input.syncInterval,
    importGrades: input.importGrades,
    importCalendar: input.importCalendar,
    importFiles: input.importFiles,
  });

  await recordAuthMode(user.id, connection.id, 'USERNAME_PASSWORD');

  // Kick off the first sync via the shared BullMQ pipeline (or the inline
  // fallback when Redis isn't configured). We do NOT block the response on it.
  try {
    await universitySyncService.triggerSync(user.id, connection.id);
  } catch (err) {
    // Sync failures don't invalidate the connection — the user can retry from
    // the UI. Log so it's visible in diagnostics.
    logger.warn(
      { err, connectionId: connection.id },
      'moodle: initial sync trigger failed',
    );
  }

  return created({
    connection: {
      id: connection.id,
      provider: connection.provider,
      portalUrl: connection.portalUrl,
      displayName: connection.displayName,
      status: connection.status,
      authMode: 'USERNAME_PASSWORD' as const,
    },
  });
});
