import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, readQuery, route } from '@/server/lib/handler';
import { created, ok } from '@/server/lib/response';
import { groupService } from '@/server/services/group.service';
import { broadcast, groupTopic } from '@/server/lib/realtime';
import { listMessagesSchema } from '@/server/validators/group.validator';

const sendSchema = z.object({
  content: z.string().trim().min(1, 'Message cannot be empty').max(4000),
  replyToId: z.string().min(1).optional(),
});

export const GET = route<{ id: string; channelId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const q = readQuery(req, listMessagesSchema);
  return ok(await groupService.listMessages(user.id, params.id, params.channelId, { limit: q.limit, before: q.before }));
});

// Sending is now a REST call that persists the message and broadcasts it over
// Supabase Realtime, replacing the old Socket.io emit.
export const POST = route<{ id: string; channelId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { content, replyToId } = await readJson(req, sendSchema);
  const message = await groupService.createMessage(user.id, params.id, params.channelId, content, replyToId);
  await broadcast(groupTopic(params.id), 'message:new', message);
  return created(message);
});
