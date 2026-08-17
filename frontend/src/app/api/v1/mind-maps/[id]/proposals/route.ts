import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { listProposals } from '@/server/services/mind-map-sync-proposal.service';

/**
 * GET /api/v1/mind-maps/:id/proposals
 * Lists PENDING sync proposals for a map — the mind-map editor's badge
 * queries this on load and after a manual sync.
 */
export const GET = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await listProposals(user.id, params.id));
});
