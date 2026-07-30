import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readQuery, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { scheduleService } from '@/server/services/schedule.service';
import { weekQuerySchema } from '@/server/validators/schedule.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const query = readQuery(req, weekQuerySchema);
  let weekStart = query.weekStart ? new Date(query.weekStart) : new Date();
  weekStart.setHours(0, 0, 0, 0);
  if (!query.weekStart) {
    const daysSinceMonday = (weekStart.getDay() + 6) % 7;
    weekStart = new Date(weekStart.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
  }
  return ok(await scheduleService.getWeek(user.id, weekStart));
});
