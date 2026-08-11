import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok, created } from '@/server/lib/response';
import { groupService } from '@/server/services/group.service';

export const GET = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await groupService.listTasks(user.id, params.id));
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  dueAt: z.string().datetime().optional(),
});

export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const body = await readJson(req, createSchema);
  return created(await groupService.addTask(user.id, params.id, body));
});
