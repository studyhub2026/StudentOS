import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { noteService } from '@/server/services/note.service';

export const DELETE = route<{ id: string; shareId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await noteService.revokeShare(user.id, params.id, params.shareId);
  return ok({ message: 'Share revoked' });
});
