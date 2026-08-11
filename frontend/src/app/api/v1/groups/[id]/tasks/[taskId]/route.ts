import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { groupService } from '@/server/services/group.service';

export const PATCH = route<{ id: string; taskId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await groupService.toggleTask(user.id, params.id, params.taskId));
});

export const DELETE = route<{ id: string; taskId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await groupService.deleteTask(user.id, params.id, params.taskId);
  return ok({ deleted: true });
});
