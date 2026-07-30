export const maxDuration = 60;
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { aiService } from '@/server/services/ai.service';
import { sendMessageSchema } from '@/server/validators/ai.validator';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return ok(await aiService.sendMessage(user.id, await readJson(req, sendMessageSchema)));
});
