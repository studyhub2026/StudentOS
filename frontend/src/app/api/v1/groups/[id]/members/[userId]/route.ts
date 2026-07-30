import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { groupService } from '@/server/services/group.service';
import { broadcast, groupTopic } from '@/server/lib/realtime';

export const DELETE = route<{ id: string; userId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await groupService.removeMember(user.id, params.id, params.userId);
  await broadcast(groupTopic(params.id), 'member:left', { groupId: params.id, userId: params.userId });
  return ok({ message: 'Member removed' });
});
