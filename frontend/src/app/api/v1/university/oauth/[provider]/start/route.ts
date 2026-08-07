import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { BadRequestError } from '@/server/lib/errors';
import { prisma } from '@/server/db';
import { getAdapter, slugToProvider, isProviderReady } from '@/server/services/lms';
import { createLmsState } from '@/server/services/lms-oauth.service';

const startSchema = z.object({
  portalUrl: z.string().trim().url(),
  displayName: z.string().trim().min(1).max(120),
});

/**
 * POST /api/v1/university/oauth/{provider}/start
 * Body: { portalUrl, displayName }
 *
 * Creates a DISCONNECTED LmsConnection row and returns the provider's authorize
 * URL. Frontend redirects the user to that URL; when they authorize, the
 * provider redirects back to /callback with ?code=…&state=…
 */
export const POST = route<{ provider: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const provider = slugToProvider(params.provider);
  if (!provider) throw new BadRequestError(`Unknown LMS provider: ${params.provider}`);
  if (!isProviderReady(provider)) {
    throw new BadRequestError(
      `${params.provider} is not configured on this server. Ask your admin to set the LMS OAuth credentials.`,
    );
  }

  const { portalUrl, displayName } = await readJson(req, startSchema);

  // Reuse existing connection if the user retries after closing the popup;
  // otherwise create a new placeholder in DISCONNECTED state.
  const existing = await prisma.lmsConnection.findUnique({
    where: {
      userId_provider_portalUrl: { userId: user.id, provider, portalUrl },
    },
    select: { id: true },
  });

  const connection =
    existing ??
    (await prisma.lmsConnection.create({
      data: {
        userId: user.id,
        provider,
        displayName,
        portalUrl,
        status: 'DISCONNECTED',
        autoSync: true,
        syncInterval: 60,
        importGrades: true,
        importCalendar: true,
        importFiles: true,
      },
      select: { id: true },
    }));

  const state = createLmsState({
    provider,
    userId: user.id,
    connectionId: connection.id,
  });

  const adapter = getAdapter(provider, portalUrl);
  const authorizeUrl = adapter.getAuthorizeUrl(state);

  return ok({ connectionId: connection.id, authorizeUrl });
});
