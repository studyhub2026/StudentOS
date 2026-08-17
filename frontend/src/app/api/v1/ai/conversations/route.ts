import type { AiFeature } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, readQuery, route } from '@/server/lib/handler';
import { created, ok } from '@/server/lib/response';
import { aiService } from '@/server/services/ai.service';
import { createConversationSchema, listConversationsSchema } from '@/server/validators/ai.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { feature, archived } = readQuery(req, listConversationsSchema);
  return ok(await aiService.listConversations(user.id, feature as AiFeature | undefined, archived));
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return created(await aiService.createConversation(user.id, await readJson(req, createConversationSchema)));
});
