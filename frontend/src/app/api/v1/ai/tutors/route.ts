import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created, ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { tutorService } from '@/server/services/tutor.service';
import { createTutorSchema } from '@/server/validators/tutor.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-list', ...TUTOR_LIMITS.standard });
  return ok(await tutorService.listTutors(user.id));
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-create', ...TUTOR_LIMITS.standard });
  const body = await readJson(req, createTutorSchema);
  return created(await tutorService.createTutor(user.id, body));
});
