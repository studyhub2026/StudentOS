export const maxDuration = 60;
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { tutorInsightService } from '@/server/services/tutor-insight.service';

export const GET = route<{ tutorId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-insight-get', ...TUTOR_LIMITS.standard });
  const { insight, recommendations } = await tutorInsightService.getLatestInsight(
    user.id,
    params.tutorId,
  );
  return ok({
    insight: insight?.content ?? null,
    generatedAt: insight?.createdAt ?? null,
    recommendations,
  });
});

export const POST = route<{ tutorId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-insight-gen', ...TUTOR_LIMITS.generation });
  return ok(await tutorInsightService.generateInsights(user.id, params.tutorId));
});
