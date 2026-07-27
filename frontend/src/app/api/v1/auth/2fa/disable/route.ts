import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { totpService } from '@/server/services/totp.service';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { disable2faSchema } from '@/server/validators/auth.validator';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { totp } = await readJson(req, disable2faSchema);
  await totpService.disable(user.id, totp);
  return ok({ message: 'Two-factor authentication disabled' });
});
