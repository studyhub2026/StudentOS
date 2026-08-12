import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { cachedOk } from '@/server/lib/response';
import { listPublicRegistry } from '@/server/services/lms';

/**
 * GET /api/v1/university/providers
 * The client-visible view of the LMS registry — used by the University page
 * to build the Provider Health Dashboard and drive the Add Connection form
 * without hardcoding any provider metadata client-side.
 *
 * The body is derived from a compile-time registry and env-var readiness
 * flags — identical for every user of a given deployment. Cached at the
 * edge for 5 minutes with SWR so a redeploy that changes the registry
 * propagates within 5 min instead of on-demand-per-request.
 */
export const GET = route(async (req: NextRequest) => {
  await requireAuth(req);
  return cachedOk(listPublicRegistry(), { sMaxAge: 300, swr: 600 });
});
