import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readQuery, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { analyticsService } from '@/server/services/analytics.service';
import { analyticsQuerySchema } from '@/server/validators/schedule.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { days } = readQuery(req, analyticsQuerySchema);
  return ok(await analyticsService.getOverview(user.id, days));
});
