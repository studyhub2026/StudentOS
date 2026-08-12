import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok, created } from '@/server/lib/response';
import { groupService } from '@/server/services/group.service';

export const GET = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await groupService.listResources(user.id, params.id));
});

const createSchema = z.object({
  type: z.enum(['note', 'file', 'link']),
  title: z.string().min(1).max(200),
  url: z.string().url().optional(),
});

export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const body = await readJson(req, createSchema);
  return created(await groupService.addResource(user.id, params.id, body));
});
