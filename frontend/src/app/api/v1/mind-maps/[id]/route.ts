import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import * as mindMap from '@/server/services/mind-map.service';
import { bulkSaveSchema } from '@/server/validators/mind-map.validator';

export const GET = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await mindMap.getMindMap(user.id, params.id));
});

/**
 * Bulk-save endpoint used by the editor's auto-save loop. Payload contains
 * only the changed slice; see `BulkSaveInput` for the shape. Applied
 * transactionally so a partial apply can never leave the map in a bad state.
 */
export const PATCH = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const body = await readJson(req, bulkSaveSchema);
  return ok(await mindMap.persistBulk(user.id, params.id, body));
});

export const DELETE = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await mindMap.deleteMindMap(user.id, params.id);
  return ok({ deleted: true });
});
