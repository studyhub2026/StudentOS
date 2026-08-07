import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { previewService } from '@/server/services/lms-preview.service';

/**
 * POST /api/v1/university/preview/{previewId}/approve
 * Approves the plan → marks preview APPROVED and enqueues a real BullMQ
 * sync job (or runs inline when Redis isn't configured).
 */
export const POST = route<{ previewId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await previewService.approvePreview(user.id, params.previewId));
});
