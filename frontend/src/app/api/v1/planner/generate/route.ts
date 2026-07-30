import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { plannerService } from '@/server/services/planner.service';
import { generatePlanSchema } from '@/server/validators/schedule.validator';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return ok(await plannerService.generatePlan(user.id, await readJson(req, generatePlanSchema)));
});
