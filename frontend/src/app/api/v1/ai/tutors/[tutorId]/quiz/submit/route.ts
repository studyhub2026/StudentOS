import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { tutorInsightService } from '@/server/services/tutor-insight.service';
import { tutorQuizSubmitSchema } from '@/server/validators/tutor.validator';

export const POST = route<{ tutorId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-quiz-submit', ...TUTOR_LIMITS.standard });
  const body = await readJson(req, tutorQuizSubmitSchema);
  return ok(
    await tutorInsightService.submitQuiz(user.id, params.tutorId, {
      total: body.total,
      correct: body.correct,
      ...(body.topic ? { topic: body.topic } : {}),
      ...(body.missedTopics ? { missedTopics: body.missedTopics } : {}),
    }),
  );
});
