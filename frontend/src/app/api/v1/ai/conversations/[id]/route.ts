import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { aiService } from '@/server/services/ai.service';
import { renameConversationSchema } from '@/server/validators/ai.validator';

export const GET = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await aiService.getConversation(user.id, params.id));
});

export const PATCH = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { title } = await readJson(req, renameConversationSchema);
  await aiService.renameConversation(user.id, params.id, title);
  return ok({ message: 'Renamed' });
});

export const DELETE = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await aiService.deleteConversation(user.id, params.id);
  return ok({ message: 'Conversation deleted' });
});
