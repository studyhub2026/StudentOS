import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, readQuery, route } from '@/server/lib/handler';
import { created, ok } from '@/server/lib/response';
import * as mindMap from '@/server/services/mind-map.service';
import { createMindMapSchema, listMindMapsSchema } from '@/server/validators/mind-map.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { favorite, search } = readQuery(req, listMindMapsSchema);
  return ok(await mindMap.listMindMaps(user.id, { favoriteOnly: favorite, search }));
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const body = await readJson(req, createMindMapSchema);
  return created(await mindMap.createMindMap(user.id, body));
});
