import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { sessionService } from '@/server/services/session.service';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return ok(await sessionService.listSessions(user.id, user.sessionId));
});
