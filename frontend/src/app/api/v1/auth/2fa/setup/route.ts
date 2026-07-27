import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { totpService } from '@/server/services/totp.service';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const setup = await totpService.generateSetup(user.email);
  return ok({ secret: setup.secret, otpauthUrl: setup.otpauthUrl, qrCode: setup.qrCodeDataUrl });
});
