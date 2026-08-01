export const maxDuration = 60;
import { after, NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { tutorService } from '@/server/services/tutor.service';
import { tutorInsightService } from '@/server/services/tutor-insight.service';
import { aiMemoryService } from '@/server/services/ai-memory.service';
import { tutorChatSchema } from '@/server/validators/tutor.validator';

export const dynamic = 'force-dynamic';

export const POST = route<{ tutorId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-chat', ...TUTOR_LIMITS.generation });

  const input = await readJson(req, tutorChatSchema);

  const encoder = new TextEncoder();
  const generator = tutorService.streamMessage(user.id, params.tutorId, {
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    content: input.content,
    ...(input.tier ? { tier: input.tier } : {}),
    ...(input.difficulty ? { difficulty: input.difficulty } : {}),
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
        if (value.type === 'done') {
          // Fire the background learning pass once the full reply is known.
          const data = value.data as { reply?: string };
          if (data.reply && data.reply.trim()) {
            after(() =>
              Promise.allSettled([
                tutorInsightService.extractLearning(user.id, params.tutorId, input.content, data.reply as string),
                aiMemoryService.extractAndStore(user.id, input.content, data.reply as string),
              ]),
            );
          }
        }
        controller.enqueue(
          encoder.encode(`event: ${value.type}\ndata: ${JSON.stringify(value.data)}\n\n`),
        );
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
