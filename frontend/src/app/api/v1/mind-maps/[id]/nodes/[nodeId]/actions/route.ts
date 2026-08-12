export const maxDuration = 45;
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { runNodeAction } from '@/server/services/mind-map-ai.service';
import { nodeActionSchema } from '@/server/validators/mind-map.validator';

/**
 * POST /api/v1/mind-maps/:id/nodes/:nodeId/actions
 *
 * Runs a small AI action on a single node (explain, quiz, flashcards…).
 * Returns plain text — the client renders it in a side panel so the student
 * can read it in situ without polluting the map.
 */
export const POST = route<{ id: string; nodeId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { action } = await readJson(req, nodeActionSchema);
  return ok(await runNodeAction(user.id, params.id, params.nodeId, action));
});
