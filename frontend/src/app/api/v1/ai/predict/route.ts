import { NextRequest } from 'next/server';
import { route } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { predictGrades } from '@/server/services/ai-prediction.service';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'ai-predict', ...TUTOR_LIMITS.generation });
  const prediction = await predictGrades(user.id);
  return ok(prediction);
});
