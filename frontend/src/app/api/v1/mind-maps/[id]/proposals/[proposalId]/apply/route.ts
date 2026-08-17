import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { applyProposal } from '@/server/services/mind-map-sync-proposal.service';

/**
 * POST /api/v1/mind-maps/:id/proposals/:proposalId/apply
 * Materialises the proposed nodes/edges into the map via the ownership-safe
 * bulk-save path. Marks the proposal APPLIED.
 */
export const POST = route<{ id: string; proposalId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await applyProposal(user.id, params.id, params.proposalId);
  return ok({ applied: true });
});
