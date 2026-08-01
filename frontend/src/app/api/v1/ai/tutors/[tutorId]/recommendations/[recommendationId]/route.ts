import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { tutorInsightService } from '@/server/services/tutor-insight.service';

const schema = z.object({ done: z.boolean() });

type Params = { tutorId: string; recommendationId: string };

export const PATCH = route<Params>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-recommendation', ...TUTOR_LIMITS.standard });
  const { done } = await readJson(req, schema);
  await tutorInsightService.setRecommendationDone(user.id, params.tutorId, params.recommendationId, done);
  return ok({ message: 'Updated' });
});
