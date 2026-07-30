import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created } from '@/server/lib/response';
import { groupService } from '@/server/services/group.service';
import { joinGroupSchema } from '@/server/validators/group.validator';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { inviteCode } = await readJson(req, joinGroupSchema);
  return created(await groupService.joinByInvite(user.id, inviteCode));
});
