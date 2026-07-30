import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, readQuery, route } from '@/server/lib/handler';
import { created, paginated } from '@/server/lib/response';
import { assignmentService } from '@/server/services/assignment.service';
import { createAssignmentSchema, listAssignmentsSchema } from '@/server/validators/assignment.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const result = await assignmentService.listAssignments(user.id, readQuery(req, listAssignmentsSchema));
  return paginated(result.items, result.pagination);
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return created(await assignmentService.createAssignment(user.id, await readJson(req, createAssignmentSchema)));
});
