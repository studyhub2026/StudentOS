import type { NextRequest } from 'next/server';
import { authService } from '@/server/services/auth.service';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { forgotPasswordSchema } from '@/server/validators/auth.validator';

export const POST = route(async (req: NextRequest) => {
  const { email } = await readJson(req, forgotPasswordSchema);
  await authService.requestPasswordReset(email);
  // Always the same response — revealing whether an address is registered
  // would leak account existence.
  return ok({ message: 'If an account exists for that address, a reset link has been sent.' });
});
