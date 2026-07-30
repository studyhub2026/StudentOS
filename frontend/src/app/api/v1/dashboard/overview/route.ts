import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { dashboardService } from '@/server/services/dashboard.service';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const days = Number(req.nextUrl.searchParams.get('trendDays') ?? 14);
  const trendDays = Number.isFinite(days) ? Math.min(Math.max(days, 7), 90) : 14;
  return ok(await dashboardService.getOverview(user.id, trendDays));
});
