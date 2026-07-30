import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { focusService } from '@/server/services/focus.service';
import { endSessionSchema } from '@/server/validators/schedule.validator';

export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await focusService.endSession(user.id, params.id, await readJson(req, endSessionSchema)));
});
