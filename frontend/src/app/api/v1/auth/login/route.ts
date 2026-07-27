import type { NextRequest } from 'next/server';
import { authService } from '@/server/services/auth.service';
import { setRefreshCookie } from '@/server/lib/cookies';
import { readJson, requestContext, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { loginSchema } from '@/server/validators/auth.validator';

export const POST = route(async (req: NextRequest) => {
  const input = await readJson(req, loginSchema);
  const result = await authService.login(input, requestContext(req));
  const res = ok({
    user: result.user,
    accessToken: result.tokens.accessToken,
    expiresIn: result.tokens.expiresIn,
  });
  setRefreshCookie(res, result.tokens.refreshToken);
  return res;
});
