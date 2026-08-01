export const maxDuration = 60;
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { tutorInsightService } from '@/server/services/tutor-insight.service';
import { tutorFlashcardSchema } from '@/server/validators/tutor.validator';

export const POST = route<{ tutorId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-flashcards', ...TUTOR_LIMITS.generation });
  const body = await readJson(req, tutorFlashcardSchema);
  return ok(
    await tutorInsightService.generateFlashcards(user.id, params.tutorId, {
      count: body.count,
      ...(body.topic ? { topic: body.topic } : {}),
      ...(body.conversationId ? { conversationId: body.conversationId } : {}),
    }),
  );
});
