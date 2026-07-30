import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { assignmentService } from '@/server/services/assignment.service';
import { updateAssignmentSchema } from '@/server/validators/assignment.validator';

export const GET = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await assignmentService.getAssignment(user.id, params.id));
});

export const PATCH = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await assignmentService.updateAssignment(user.id, params.id, await readJson(req, updateAssignmentSchema)));
});

export const DELETE = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await assignmentService.deleteAssignment(user.id, params.id);
  return ok({ message: 'Assignment deleted' });
});
