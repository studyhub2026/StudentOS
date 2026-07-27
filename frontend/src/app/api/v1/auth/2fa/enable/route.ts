import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { totpService } from '@/server/services/totp.service';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';

const schema = z.object({
  secret: z.string().min(1, 'Enrolment secret is required'),
  totp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { secret, totp } = await readJson(req, schema);
  await totpService.enable(user.id, secret, totp);
  return ok({ message: 'Two-factor authentication enabled' });
});
