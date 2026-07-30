import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created } from '@/server/lib/response';
import { groupService } from '@/server/services/group.service';
import { createChannelSchema } from '@/server/validators/group.validator';

export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return created(await groupService.createChannel(user.id, params.id, await readJson(req, createChannelSchema)));
});
