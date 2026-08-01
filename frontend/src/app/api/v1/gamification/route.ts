import { NextRequest } from 'next/server';
import { route } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok } from '@/server/lib/response';
import { getGamificationProfile } from '@/server/services/gamification.service';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const profile = await getGamificationProfile(user.id);
  return ok(profile);
});
