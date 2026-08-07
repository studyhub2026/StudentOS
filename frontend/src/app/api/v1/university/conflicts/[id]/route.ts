import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { conflictService } from '@/server/services/lms-conflict.service';

const resolveSchema = z.object({
  action: z.enum(['KEEP_LOCAL', 'KEEP_REMOTE', 'MERGE', 'IGNORE']),
  mergedData: z.record(z.string(), z.unknown()).optional(),
});

/**
 * GET  /api/v1/university/conflicts/{id}  → the conflict + full resolution history
 * PATCH /api/v1/university/conflicts/{id}  → resolve with one of the 4 actions
 */
export const GET = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await conflictService.getConflict(user.id, params.id));
});

export const PATCH = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { action, mergedData } = await readJson(req, resolveSchema);
  return ok(await conflictService.resolveConflict(user.id, params.id, action, mergedData));
});
