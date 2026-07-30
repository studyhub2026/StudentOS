import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { groupService } from '@/server/services/group.service';

export const POST = route<{ id: string; userId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await groupService.transferOwnership(user.id, params.id, params.userId);
  return ok({ message: 'Ownership transferred' });
});
