import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { previewService } from '@/server/services/lms-preview.service';

/**
 * GET /api/v1/university/preview/{previewId} — fetch a preview for the UI.
 * DELETE /api/v1/university/preview/{previewId} — cancel a pending preview.
 */
export const GET = route<{ previewId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await previewService.getPreview(user.id, params.previewId));
});

export const DELETE = route<{ previewId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await previewService.cancelPreview(user.id, params.previewId);
  return ok({ cancelled: true });
});
