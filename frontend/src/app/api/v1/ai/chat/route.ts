export const maxDuration = 60;
import { after } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { aiService } from '@/server/services/ai.service';
import { aiMemoryService } from '@/server/services/ai-memory.service';
import { sendMessageSchema } from '@/server/validators/ai.validator';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const body = await readJson(req, sendMessageSchema);
  const result = await aiService.sendMessage(user.id, body);

  // Learn durable facts about the student in the background — after the reply
  // has been sent, so it never adds latency and a failure is harmless.
  after(() => aiMemoryService.extractAndStore(user.id, body.content, result.message.content));

  return ok(result);
});
