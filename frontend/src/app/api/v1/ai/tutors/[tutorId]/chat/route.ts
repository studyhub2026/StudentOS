export const maxDuration = 60;
import { after } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { tutorService } from '@/server/services/tutor.service';
import { tutorInsightService } from '@/server/services/tutor-insight.service';
import { aiMemoryService } from '@/server/services/ai-memory.service';
import { tutorChatSchema } from '@/server/validators/tutor.validator';

export const POST = route<{ tutorId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-chat', ...TUTOR_LIMITS.generation });

  const body = await readJson(req, tutorChatSchema);
  const result = await tutorService.sendMessage(user.id, params.tutorId, body);

  // Learn from the turn in the background — both the tutor's own progress and
  // the global, cross-subject memory (name, level…). Never adds reply latency.
  after(() =>
    Promise.allSettled([
      tutorInsightService.extractLearning(user.id, params.tutorId, body.content, result.message.content),
      aiMemoryService.extractAndStore(user.id, body.content, result.message.content),
    ]),
  );

  return ok(result);
});
