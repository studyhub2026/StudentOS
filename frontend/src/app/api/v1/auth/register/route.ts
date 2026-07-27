import type { NextRequest } from 'next/server';
import { authService } from '@/server/services/auth.service';
import { setRefreshCookie } from '@/server/lib/cookies';
import { readJson, requestContext, route } from '@/server/lib/handler';
import { created } from '@/server/lib/response';
import { registerSchema } from '@/server/validators/auth.validator';

export const POST = route(async (req: NextRequest) => {
  const input = await readJson(req, registerSchema);
  const result = await authService.register(input, requestContext(req));
  const res = created({
    user: result.user,
    accessToken: result.tokens.accessToken,
    expiresIn: result.tokens.expiresIn,
  });
  setRefreshCookie(res, result.tokens.refreshToken);
  return res;
});
