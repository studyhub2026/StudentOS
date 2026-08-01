import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { tutorService } from '@/server/services/tutor.service';
import { updateTutorMessageSchema } from '@/server/validators/tutor.validator';

type Params = { tutorId: string; messageId: string };

export const PATCH = route<Params>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-message', ...TUTOR_LIMITS.standard });
  const body = await readJson(req, updateTutorMessageSchema);
  return ok(await tutorService.updateMessage(user.id, params.tutorId, params.messageId, body));
});
