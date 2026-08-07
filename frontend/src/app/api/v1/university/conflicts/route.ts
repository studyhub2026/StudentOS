import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/lib/auth';
import { readQuery, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { conflictService } from '@/server/services/lms-conflict.service';

const querySchema = z.object({
  status: z.enum(['PENDING', 'RESOLVED', 'IGNORED', 'ALL']).default('PENDING'),
});

/**
 * GET /api/v1/university/conflicts?status=PENDING
 * Lists conflicts for the current user, filtered by status.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { status } = readQuery(req, querySchema);
  return ok(await conflictService.listConflicts(user.id, status));
});
