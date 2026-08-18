import type { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireAuth } from '@/server/lib/auth';
import { BadRequestError } from '@/server/lib/errors';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const assignmentId = req.nextUrl.searchParams.get('assignmentId') ?? undefined;
  const noteId = req.nextUrl.searchParams.get('noteId') ?? undefined;
  const subjectId = req.nextUrl.searchParams.get('subjectId') ?? undefined;
  if (!assignmentId && !noteId && !subjectId) throw new BadRequestError('Specify assignmentId, noteId, or subjectId');

  const assets = await prisma.fileAsset.findMany({
    where: { userId: user.id, ...(assignmentId ? { assignmentId } : {}), ...(noteId ? { noteId } : {}), ...(subjectId ? { subjectId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
  return ok(assets);
});
