import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created, ok } from '@/server/lib/response';
import { groupService } from '@/server/services/group.service';
import { createGroupSchema } from '@/server/validators/group.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return ok(await groupService.listGroups(user.id));
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return created(await groupService.createGroup(user.id, await readJson(req, createGroupSchema)));
});
