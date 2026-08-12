import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { groupService } from '@/server/services/group.service';

export const DELETE = route<{ id: string; resourceId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await groupService.deleteResource(user.id, params.id, params.resourceId);
  return ok({ deleted: true });
});
