export const maxDuration = 45;
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { expandNode } from '@/server/services/mind-map-ai.service';
import { expandNodeSchema } from '@/server/validators/mind-map.validator';

/**
 * POST /api/v1/mind-maps/:id/nodes/:nodeId/expand
 *
 * Returns 1–10 AI-generated child nodes for the given node. The client is
 * expected to preview them before persisting via the normal bulk-save path.
 */
export const POST = route<{ id: string; nodeId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { count } = await readJson(req, expandNodeSchema);
  return ok(await expandNode(user.id, params.id, params.nodeId, count));
});
