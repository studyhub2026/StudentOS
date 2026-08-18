import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { aiService } from '@/server/services/ai.service';
import { updateConversationSchema } from '@/server/validators/ai.validator';

export const GET = route<{ conversationId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await aiService.getConversation(user.id, params.conversationId));
});

export const PATCH = route<{ conversationId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { title, pinned, archived } = await readJson(req, updateConversationSchema);
  if (title !== undefined) await aiService.renameConversation(user.id, params.conversationId, title);
  if (pinned !== undefined) await aiService.setPinned(user.id, params.conversationId, pinned);
  if (archived !== undefined) await aiService.setArchived(user.id, params.conversationId, archived);
  return ok({ message: 'Updated' });
});

export const DELETE = route<{ conversationId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await aiService.deleteConversation(user.id, params.conversationId);
  return ok({ message: 'Conversation deleted' });
});
