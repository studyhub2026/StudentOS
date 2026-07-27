import type { NextRequest } from 'next/server';
import { authService } from '@/server/services/auth.service';
import { requireAuth } from '@/server/lib/auth';
import { REFRESH_COOKIE_NAME, clearRefreshCookie } from '@/server/lib/cookies';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const cookie = req.cookies.get(REFRESH_COOKIE_NAME)?.value;
  await authService.logout(user.sessionId, cookie);
  const res = ok({ message: 'Signed out' });
  clearRefreshCookie(res);
  return res;
});
