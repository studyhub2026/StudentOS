export const maxDuration = 60;
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { aiService } from '@/server/services/ai.service';
import { sendMessageSchema } from '@/server/validators/ai.validator';

// Server-sent events for the chat UI. One-directional and short-lived, so SSE
// over a streamed Response fits Vercel far better than a WebSocket would.
export const dynamic = 'force-dynamic';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const input = await readJson(req, sendMessageSchema);

  const encoder = new TextEncoder();
  const generator = aiService.streamMessage(user.id, {
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    feature: input.feature,
    content: input.content,
    signal: req.signal,
  });

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await generator.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`event: ${value.type}\ndata: ${JSON.stringify(value.data)}\n\n`));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Generation failed';
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`));
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
});
