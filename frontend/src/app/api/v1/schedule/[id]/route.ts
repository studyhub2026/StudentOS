import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { scheduleService } from '@/server/services/schedule.service';
import { updateBlockSchema } from '@/server/validators/schedule.validator';

export const PATCH = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await scheduleService.updateBlock(user.id, params.id, await readJson(req, updateBlockSchema)));
});

export const DELETE = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const scope = (req.nextUrl.searchParams.get('scope') as 'one' | 'following' | 'all' | null) ?? 'one';
  const deleted = await scheduleService.deleteBlock(user.id, params.id, scope);
  return ok({ deleted });
});
