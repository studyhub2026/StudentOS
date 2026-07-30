import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { assignmentService } from '@/server/services/assignment.service';
import { bulkUpdateSchema } from '@/server/validators/assignment.validator';

export const PATCH = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const updated = await assignmentService.bulkUpdate(user.id, await readJson(req, bulkUpdateSchema));
  return ok({ updated });
});
