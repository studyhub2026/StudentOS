import type { NextRequest } from 'next/server';
import { authService } from '@/server/services/auth.service';
import { clearRefreshCookie } from '@/server/lib/cookies';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { resetPasswordSchema } from '@/server/validators/auth.validator';

export const POST = route(async (req: NextRequest) => {
  const { token, password } = await readJson(req, resetPasswordSchema);
  await authService.resetPassword(token, password);
  const res = ok({ message: 'Password reset. Please sign in.' });
  clearRefreshCookie(res);
  return res;
});
