import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, readQuery, route } from '@/server/lib/handler';
import { created, ok } from '@/server/lib/response';
import { scheduleService } from '@/server/services/schedule.service';
import { createBlockSchema, listBlocksSchema } from '@/server/validators/schedule.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return ok(await scheduleService.listBlocks(user.id, readQuery(req, listBlocksSchema)));
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return created(await scheduleService.createBlock(user.id, await readJson(req, createBlockSchema)));
});
