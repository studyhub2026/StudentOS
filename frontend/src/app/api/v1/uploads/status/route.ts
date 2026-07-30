import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { uploadService } from '@/server/services/upload.service';

export const GET = route(async (req: NextRequest) => {
  await requireAuth(req);
  return ok({ configured: uploadService.isConfigured(), provider: 'cloudinary' });
});
