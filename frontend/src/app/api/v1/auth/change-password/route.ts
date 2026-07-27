import type { NextRequest } from 'next/server';
import { authService } from '@/server/services/auth.service';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { changePasswordSchema } from '@/server/validators/auth.validator';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { currentPassword, newPassword } = await readJson(req, changePasswordSchema);
  await authService.changePassword(user.id, currentPassword, newPassword, user.sessionId);
  return ok({ message: 'Password changed. Other sessions were signed out.' });
});
