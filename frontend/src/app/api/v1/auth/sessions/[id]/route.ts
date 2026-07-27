import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { sessionService } from '@/server/services/session.service';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';

export const DELETE = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await sessionService.revokeSession(user.id, params.id);
  return ok({ message: 'Session revoked' });
});
