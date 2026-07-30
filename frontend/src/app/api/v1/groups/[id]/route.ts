import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { groupService } from '@/server/services/group.service';
import { updateGroupSchema } from '@/server/validators/group.validator';

export const GET = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await groupService.getGroup(user.id, params.id));
});

export const PATCH = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await groupService.updateGroup(user.id, params.id, await readJson(req, updateGroupSchema)));
});

export const DELETE = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await groupService.deleteGroup(user.id, params.id);
  return ok({ message: 'Group deleted' });
});
