import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created } from '@/server/lib/response';
import { focusService } from '@/server/services/focus.service';
import { startSessionSchema } from '@/server/validators/schedule.validator';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return created(await focusService.startSession(user.id, await readJson(req, startSessionSchema)));
});
