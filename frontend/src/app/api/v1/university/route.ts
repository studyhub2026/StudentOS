import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created, ok } from '@/server/lib/response';
import { universitySyncService } from '@/server/services/university-sync.service';
import { createConnectionSchema } from '@/server/validators/university.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return ok(await universitySyncService.listConnections(user.id));
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const input = await readJson(req, createConnectionSchema);
  return created(await universitySyncService.createConnection(user.id, input));
});
