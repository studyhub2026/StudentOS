export const maxDuration = 45;
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { askMap } from '@/server/services/mind-map-ai.service';
import { chatMapSchema } from '@/server/validators/mind-map.validator';

/**
 * POST /api/v1/mind-maps/:id/chat
 *
 * Ask a free-form question grounded in the current map. Context is limited
 * to the map outline (+ selected branch if provided) — never the whole DB.
 */
export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const body = await readJson(req, chatMapSchema);
  return ok(await askMap(user.id, params.id, body));
});
