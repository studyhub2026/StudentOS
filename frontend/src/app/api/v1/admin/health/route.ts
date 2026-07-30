import type { NextRequest } from 'next/server';
import { env } from '@/server/env';
import { requireAuth, requireRole } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { adminService } from '@/server/services/admin.service';
import { uploadService } from '@/server/services/upload.service';
import { oauthService } from '@/server/services/oauth.service';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  requireRole(user, 'ADMIN');
  return ok(
    await adminService.getSystemHealth({
      gemini: env.hasGemini,
      cloudinary: uploadService.isConfigured(),
      redis: false,
      oauth: oauthService.listConfiguredProviders(),
      environment: env.NODE_ENV,
    }),
  );
});
