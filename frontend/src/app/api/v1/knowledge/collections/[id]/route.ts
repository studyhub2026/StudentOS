import { NextRequest } from 'next/server';
import { z } from 'zod';
import { route, readJson } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok } from '@/server/lib/response';
import { updateCollection, deleteCollection } from '@/server/services/knowledge.service';

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  color: z.string().max(20).optional(),
  icon: z.string().max(30).optional(),
});

export const PATCH = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const body = await readJson(req, updateSchema);
  const collection = await updateCollection(user.id, params.id, body);
  return ok(collection);
});

export const DELETE = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await deleteCollection(user.id, params.id);
  return ok({ deleted: true });
});
