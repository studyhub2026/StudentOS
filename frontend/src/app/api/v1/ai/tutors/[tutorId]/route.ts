import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { tutorService } from '@/server/services/tutor.service';
import { tutorInsightService } from '@/server/services/tutor-insight.service';
import { updateTutorSchema } from '@/server/validators/tutor.validator';

export const GET = route<{ tutorId: string }>(async (req, { params }) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-detail', ...TUTOR_LIMITS.standard });

  const tutor = await tutorService.getTutorOrThrow(user.id, params.tutorId);
  const [conversations, { insight, recommendations }] = await Promise.all([
    tutorService.listConversations(user.id, params.tutorId),
    tutorInsightService.getLatestInsight(user.id, params.tutorId),
  ]);

  const { progress, ...rest } = tutor;
  return ok({
    tutor: rest,
    progress,
    conversations,
    insight: insight?.content ?? null,
    insightGeneratedAt: insight?.createdAt ?? null,
    recommendations,
  });
});

export const PATCH = route<{ tutorId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-update', ...TUTOR_LIMITS.standard });
  const body = await readJson(req, updateTutorSchema);
  return ok(await tutorService.updateTutor(user.id, params.tutorId, body));
});
