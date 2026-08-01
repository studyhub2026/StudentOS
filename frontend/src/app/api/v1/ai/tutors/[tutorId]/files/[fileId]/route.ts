import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { tutorFileService } from '@/server/services/tutor-file.service';

type Params = { tutorId: string; fileId: string };

export const DELETE = route<Params>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'tutor-file-delete', ...TUTOR_LIMITS.standard });
  await tutorFileService.deleteFile(user.id, params.fileId);
  return ok({ message: 'File deleted' });
});
