import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { listPublicRegistry } from '@/server/services/lms';

/**
 * GET /api/v1/university/providers
 * The client-visible view of the LMS registry — used by the University page
 * to build the Provider Health Dashboard and drive the Add Connection form
 * without hardcoding any provider metadata client-side.
 */
export const GET = route(async (req: NextRequest) => {
  await requireAuth(req);
  return ok(listPublicRegistry());
});
