import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { groupService } from '@/server/services/group.service';
import { broadcast, groupTopic } from '@/server/lib/realtime';
import { editMessageSchema } from '@/server/validators/group.validator';

export const PATCH = route<{ id: string; messageId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { content } = await readJson(req, editMessageSchema);
  const message = await groupService.editMessage(user.id, params.id, params.messageId, content);
  await broadcast(groupTopic(params.id), 'message:updated', { ...message, channelId: null });
  return ok(message);
});

export const DELETE = route<{ id: string; messageId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { channelId } = await groupService.deleteMessage(user.id, params.id, params.messageId);
  await broadcast(groupTopic(params.id), 'message:deleted', { messageId: params.messageId, channelId });
  return ok({ message: 'Message deleted' });
});
