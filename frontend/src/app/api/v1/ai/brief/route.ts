export const maxDuration = 60;
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { aiBriefService } from '@/server/services/ai-brief.service';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return ok(await aiBriefService.getOrCreateTodayBrief(user.id));
});
