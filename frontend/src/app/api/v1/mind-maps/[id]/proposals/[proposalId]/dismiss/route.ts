import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { dismissProposal } from '@/server/services/mind-map-sync-proposal.service';

/**
 * POST /api/v1/mind-maps/:id/proposals/:proposalId/dismiss
 * Marks the proposal DISMISSED so it no longer appears in the badge count.
 */
export const POST = route<{ id: string; proposalId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await dismissProposal(user.id, params.id, params.proposalId);
  return ok({ dismissed: true });
});
