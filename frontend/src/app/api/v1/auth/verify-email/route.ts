import type { NextRequest } from 'next/server';
import { authService } from '@/server/services/auth.service';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { verifyEmailSchema } from '@/server/validators/auth.validator';

export const POST = route(async (req: NextRequest) => {
  const { token } = await readJson(req, verifyEmailSchema);
  await authService.verifyEmail(token);
  return ok({ message: 'Email verified' });
});
