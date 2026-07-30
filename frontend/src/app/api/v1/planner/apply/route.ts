import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created } from '@/server/lib/response';
import { plannerService } from '@/server/services/planner.service';
import { applyPlanSchema } from '@/server/validators/schedule.validator';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const input = await readJson(req, applyPlanSchema);
  if (input.replaceExisting && input.from && input.to) {
    await plannerService.clearGeneratedBlocks(user.id, input.from, input.to);
  }
  const createdCount = await plannerService.applyPlan(user.id, input.sessions);
  return created({ created: createdCount });
});
