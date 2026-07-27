import type { NextRequest } from 'next/server';
import { authService } from '@/server/services/auth.service';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  await authService.resendVerification(user.id);
  return ok({ message: 'Verification email sent' });
});
