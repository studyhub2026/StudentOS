import { NextRequest } from 'next/server';
import { z } from 'zod';
import { route, readJson } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok, created } from '@/server/lib/response';
import { listCollections, createCollection } from '@/server/services/knowledge.service';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  color: z.string().max(20).optional(),
  icon: z.string().max(30).optional(),
});

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const collections = await listCollections(user.id);
  return ok(collections);
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const body = await readJson(req, createSchema);
  const collection = await createCollection(user.id, body);
  return created(collection);
});
