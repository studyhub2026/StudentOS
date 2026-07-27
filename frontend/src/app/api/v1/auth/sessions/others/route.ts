import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { sessionService } from '@/server/services/session.service';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';

export const DELETE = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const revoked = await sessionService.revokeOtherSessions(user.id, user.sessionId);
  return ok({ revoked });
});
