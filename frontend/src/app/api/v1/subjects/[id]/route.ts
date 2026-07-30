import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { subjectService } from '@/server/services/subject.service';
import { updateSubjectSchema } from '@/server/validators/assignment.validator';

export const PATCH = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await subjectService.updateSubject(user.id, params.id, await readJson(req, updateSubjectSchema)));
});

export const DELETE = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await subjectService.deleteSubject(user.id, params.id);
  return ok({ message: 'Subject deleted' });
});
