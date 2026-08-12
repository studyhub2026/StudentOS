export const maxDuration = 60;
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created } from '@/server/lib/response';
import { generateMindMapFromPrompt } from '@/server/services/mind-map-ai.service';
import { generateMindMapSchema } from '@/server/validators/mind-map.validator';

/**
 * POST /api/v1/mind-maps/generate
 *
 * Creates a brand-new mind map from an AI prompt. Returns the new map id so
 * the client can navigate straight into the editor.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const body = await readJson(req, generateMindMapSchema);
  const { mapId } = await generateMindMapFromPrompt(user.id, body);
  return created({ id: mapId });
});
