export const maxDuration = 60;
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { aiService } from '@/server/services/ai.service';
import { sendMessageSchema } from '@/server/validators/ai.validator';

/**
 * Server-sent events for the chat UI. One-directional and short-lived, so SSE
 * over a streamed Response fits Vercel far better than a WebSocket would.
 *
 * Two things matter for perceived latency here:
 *   1. Push each Gemini delta to the client the instant it arrives — do NOT
 *      wait for `pull` back-pressure from the consumer. We use `start(controller)`
 *      with a fire-and-forget forwarding loop.
 *   2. Flush the response headers immediately with an SSE comment ping so the
 *      browser's fetch reader unblocks at t=0 instead of waiting for the first
 *      real event (which can be 100–400ms behind the Gemini call).
 */
export const dynamic = 'force-dynamic';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const input = await readJson(req, sendMessageSchema);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Immediate flush so the client's fetch reader sees data at t=0. SSE
      // comment lines start with ':' and are ignored by the parser but count
      // as a frame boundary for the browser's HTTP layer.
      controller.enqueue(encoder.encode(':ok\n\n'));

      // Drive the generator without waiting for `pull` — each delta ships as
      // soon as Gemini emits it, so long replies feel like live typing rather
      // than a blank pause.
      void (async () => {
        try {
          const generator = aiService.streamMessage(user.id, {
            ...(input.conversationId ? { conversationId: input.conversationId } : {}),
            feature: input.feature,
            content: input.content,
            ...(input.tier ? { tier: input.tier } : {}),
            ...(input.fileIds && input.fileIds.length > 0 ? { fileIds: input.fileIds } : {}),
            ...(input.provider ? { preferredProvider: input.provider } : {}),
            ...(input.contextRefs && input.contextRefs.length > 0 ? { contextRefs: input.contextRefs } : {}),
            signal: req.signal,
          });
          for await (const frame of generator) {
            controller.enqueue(
              encoder.encode(`event: ${frame.type}\ndata: ${JSON.stringify(frame.data)}\n\n`),
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Generation failed';
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`),
          );
        } finally {
          controller.close();
        }
      })();
    },
    cancel() {
      // The `req.signal` we passed into the generator already aborts the
      // Gemini call when the client disconnects; nothing more to do here.
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
