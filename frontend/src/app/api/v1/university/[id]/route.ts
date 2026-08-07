import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { universitySyncService } from '@/server/services/university-sync.service';
import { updateConnectionSchema } from '@/server/validators/university.validator';

export const GET = route<{ id: string }>(async (req, { params }) => {
  const user = await requireAuth(req);
  return ok(await universitySyncService.getConnection(user.id, params.id));
});

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const user = await requireAuth(req);
  const input = await readJson(req, updateConnectionSchema);
  return ok(await universitySyncService.updateConnection(user.id, params.id, input));
});

export const DELETE = route<{ id: string }>(async (req, { params }) => {
  const user = await requireAuth(req);
  await universitySyncService.deleteConnection(user.id, params.id);
  return ok({ deleted: true });
});
