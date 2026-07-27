import type { NextRequest } from 'next/server';
import { authService } from '@/server/services/auth.service';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return ok(await authService.getCurrentUser(user.id));
});
