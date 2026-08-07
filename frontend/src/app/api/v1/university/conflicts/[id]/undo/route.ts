import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { conflictService } from '@/server/services/lms-conflict.service';

/**
 * POST /api/v1/university/conflicts/{id}/undo
 * Reverts the most recent resolution (moves the conflict back to PENDING)
 * and records the undo in the audit trail.
 */
export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await conflictService.undoLastResolution(user.id, params.id));
});
