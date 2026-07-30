import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { uploadService, type UploadFolder } from '@/server/services/upload.service';
import { signUploadSchema } from '@/server/validators/upload.validator';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { folder } = await readJson(req, signUploadSchema);
  return ok(uploadService.createSignedUpload(user.id, folder as UploadFolder));
});
