import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created, ok } from '@/server/lib/response';
import { subjectService } from '@/server/services/subject.service';
import { createSubjectSchema } from '@/server/validators/assignment.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const includeArchived = req.nextUrl.searchParams.get('includeArchived') === 'true';
  return ok(await subjectService.listSubjects(user.id, includeArchived));
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return created(await subjectService.createSubject(user.id, await readJson(req, createSubjectSchema)));
});
