import type { NextRequest } from 'next/server';
import type { GroupRole } from '@prisma/client';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { groupService } from '@/server/services/group.service';
import { memberRoleSchema } from '@/server/validators/group.validator';

export const PATCH = route<{ id: string; userId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { role } = await readJson(req, memberRoleSchema);
  await groupService.changeMemberRole(user.id, params.id, params.userId, role as GroupRole);
  return ok({ message: 'Role updated' });
});
