import type { NextRequest } from 'next/server';
import { tokenService } from '@/server/services/token.service';
import { REFRESH_COOKIE_NAME, setRefreshCookie } from '@/server/lib/cookies';
import { UnauthorizedError } from '@/server/lib/errors';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';

export const POST = route(async (req: NextRequest) => {
  const fromCookie = req.cookies.get(REFRESH_COOKIE_NAME)?.value;
  let fromBody: string | undefined;
  try {
    fromBody = ((await req.json()) as { refreshToken?: string }).refreshToken;
  } catch {
    fromBody = undefined;
  }
  const token = fromCookie ?? fromBody;
  if (!token) throw new UnauthorizedError('No refresh token provided');

  const tokens = await tokenService.rotateRefreshToken(token);
  const res = ok({ accessToken: tokens.accessToken, expiresIn: tokens.expiresIn });
  setRefreshCookie(res, tokens.refreshToken);
  return res;
});
