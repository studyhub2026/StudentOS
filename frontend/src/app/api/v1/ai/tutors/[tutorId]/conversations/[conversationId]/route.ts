import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { tutorService } from '@/server/services/tutor.service';
import { renameTutorConversationSchema } from '@/server/validators/tutor.validator';

type Params = { tutorId: string; conversationId: string };

export const GET = route<Params>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-conv-get', ...TUTOR_LIMITS.standard });
  return ok(await tutorService.getConversation(user.id, params.tutorId, params.conversationId));
});

export const PATCH = route<Params>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-conv-update', ...TUTOR_LIMITS.standard });
  const body = await readJson(req, renameTutorConversationSchema);
  await tutorService.updateConversation(user.id, params.tutorId, params.conversationId, body);
  return ok({ message: 'Updated' });
});

export const DELETE = route<Params>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-conv-delete', ...TUTOR_LIMITS.standard });
  await tutorService.deleteConversation(user.id, params.tutorId, params.conversationId);
  return ok({ message: 'Conversation deleted' });
});
