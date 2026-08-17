import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { aiService } from '@/server/services/ai.service';
import { z } from 'zod';

const editMessageSchema = z.object({
  content: z.string().trim().min(1, 'Message cannot be empty').max(20_000),
});

export const PATCH = route<{ conversationId: string; messageId: string }>(
  async (req: NextRequest, { params }) => {
    const user = await requireAuth(req);
    const { content } = await readJson(req, editMessageSchema);
    const updated = await aiService.editMessage(user.id, params.conversationId, params.messageId, content);
    return ok(updated);
  },
);
