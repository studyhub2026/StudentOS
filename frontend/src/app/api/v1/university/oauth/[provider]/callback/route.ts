import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { route } from '@/server/lib/handler';
import { BadRequestError } from '@/server/lib/errors';
import { prisma } from '@/server/db';
import { encrypt } from '@/server/lib/crypto';
import { env } from '@/server/env';
import { getAdapter, slugToProvider } from '@/server/services/lms';
import { verifyLmsState } from '@/server/services/lms-oauth.service';
import { universitySyncService } from '@/server/services/university-sync.service';
import { logger } from '@/server/lib/logger';

/**
 * GET /api/v1/university/oauth/{provider}/callback?code=…&state=…
 *
 * The provider redirects here after the user authorizes. We:
 *  1. Verify state (JWT — matches userId + connectionId + provider).
 *  2. Exchange code for access + refresh tokens via the adapter.
 *  3. Fetch the remote profile (best-effort, so the connection has a name).
 *  4. Encrypt and persist tokens; mark connection CONNECTED.
 *  5. Register the auto-sync scheduler.
 *  6. Trigger the initial sync so the user sees data immediately.
 *  7. Redirect to /university with a success flag.
 *
 * On any error we mark the connection ERROR with a message and redirect back
 * with ?error=… so the UI can show a toast.
 */
export const GET = route<{ provider: string }>(async (req: NextRequest, { params }) => {
  const provider = slugToProvider(params.provider);
  if (!provider) throw new BadRequestError(`Unknown LMS provider: ${params.provider}`);

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const redirectHome = (query: string) =>
    NextResponse.redirect(`${env.APP_URL}/university?${query}`);

  if (errorParam || !code || !state) {
    return redirectHome(`error=${encodeURIComponent(errorParam ?? 'missing_code_or_state')}`);
  }

  const parsed = verifyLmsState(state);
  if (parsed.provider !== provider) {
    return redirectHome('error=state_provider_mismatch');
  }

  const conn = await prisma.lmsConnection.findUnique({
    where: { id: parsed.connectionId },
    select: { id: true, userId: true, provider: true, portalUrl: true },
  });
  if (!conn || conn.userId !== parsed.userId) {
    return redirectHome('error=connection_not_found');
  }

  try {
    const adapter = getAdapter(conn.provider, conn.portalUrl);
    const tokens = await adapter.authenticate(code);

    // Best-effort profile — the connection still succeeds if this fails.
    let remoteUserId: string | undefined;
    let profileJson: Record<string, unknown> | undefined;
    try {
      const profile = await adapter.getProfile(tokens);
      remoteUserId = profile.remoteUserId;
      profileJson = profile as unknown as Record<string, unknown>;
    } catch (err) {
      logger.warn({ err, connectionId: conn.id }, 'lms callback: profile fetch failed');
    }

    const updated = await prisma.lmsConnection.update({
      where: { id: conn.id },
      data: {
        encryptedAccessToken: encrypt(tokens.accessToken),
        encryptedRefreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
        tokenExpiresAt: tokens.expiresAt,
        status: 'CONNECTED',
        statusDetail: null,
        remoteUserId,
        profileData: profileJson as Parameters<typeof prisma.lmsConnection.update>[0]['data']['profileData'],
      },
      select: {
        id: true,
        userId: true,
        provider: true,
        displayName: true,
        portalUrl: true,
        status: true,
        statusDetail: true,
        autoSync: true,
        syncInterval: true,
        importGrades: true,
        importCalendar: true,
        importFiles: true,
        lastSyncAt: true,
        createdAt: true,
        updatedAt: true,
        tokenExpiresAt: true,
        profileData: true,
        remoteUserId: true,
        adapterVersion: true,
        _count: {
          select: {
            courses: true,
            assignments: true,
            exams: true,
            announcements: true,
            grades: true,
            files: true,
            conflicts: true,
          },
        },
      },
    });

    // Register the auto-sync repeatable job + trigger initial sync.
    await universitySyncService.registerScheduler(updated);
    if (env.hasRedis) {
      await universitySyncService.triggerSync(conn.userId, conn.id);
    }

    return redirectHome('connected=1');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'oauth_callback_failed';
    logger.error({ err, connectionId: conn.id }, 'lms callback: token exchange failed');
    await prisma.lmsConnection.update({
      where: { id: conn.id },
      data: { status: 'ERROR', statusDetail: message.slice(0, 500) },
    });
    return redirectHome(`error=${encodeURIComponent(message.slice(0, 200))}`);
  }
});
