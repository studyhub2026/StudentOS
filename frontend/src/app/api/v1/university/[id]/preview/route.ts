import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { created } from '@/server/lib/response';
import { previewService } from '@/server/services/lms-preview.service';

/**
 * POST /api/v1/university/{connectionId}/preview
 * Kicks off a dry-run sync and stores the resulting plan as an LmsSyncPreview.
 * Returns the preview id — the client redirects to /university/preview/{id}.
 */
export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const preview = await previewService.createPreview(user.id, params.id);
  return created(preview);
});
