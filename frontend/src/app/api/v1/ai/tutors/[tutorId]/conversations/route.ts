import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created, ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { tutorService } from '@/server/services/tutor.service';
import { createTutorConversationSchema } from '@/server/validators/tutor.validator';

export const GET = route<{ tutorId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-conv-list', ...TUTOR_LIMITS.standard });
  return ok(await tutorService.listConversations(user.id, params.tutorId));
});

export const POST = route<{ tutorId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-conv-create', ...TUTOR_LIMITS.standard });
  const body = await readJson(req, createTutorConversationSchema);
  return created(await tutorService.createConversation(user.id, params.tutorId, body));
});
