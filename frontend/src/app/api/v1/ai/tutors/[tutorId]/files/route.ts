export const maxDuration = 60;
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, readQuery, route } from '@/server/lib/handler';
import { created, ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { tutorFileService } from '@/server/services/tutor-file.service';
import { listTutorFilesSchema, registerTutorFileSchema } from '@/server/validators/tutor.validator';

export const GET = route<{ tutorId: string }>(async (req: NextRequest) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-file-list', ...TUTOR_LIMITS.standard });
  const { conversationId } = readQuery(req, listTutorFilesSchema);
  return ok(await tutorFileService.listConversationFiles(user.id, conversationId));
});

export const POST = route<{ tutorId: string }>(async (req: NextRequest) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-file-register', ...TUTOR_LIMITS.standard });
  const body = await readJson(req, registerTutorFileSchema);
  const file = await tutorFileService.registerAndProcess(user.id, {
    tutorConversationId: body.conversationId,
    filename: body.filename,
    mimeType: body.mimeType,
    size: body.size,
    storageUrl: body.url,
    ...(body.storageKey ? { storageKey: body.storageKey } : {}),
  });
  return created(file);
});
