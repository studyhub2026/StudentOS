import { NextRequest } from 'next/server';
import { route } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok } from '@/server/lib/response';
import { getLeaderboard } from '@/server/services/gamification.service';

export const GET = route(async (req: NextRequest) => {
  await requireAuth(req);
  const leaderboard = await getLeaderboard();
  return ok(leaderboard);
});
