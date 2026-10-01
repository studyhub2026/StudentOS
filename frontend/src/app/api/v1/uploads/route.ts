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

  // When browsing a subject's files, also surface anything the LMS sync
  // mirrored into LmsFile for the course linked to this subject — otherwise
  // the student sees "No files yet" even though their university's PDFs
  // were fetched. Prefix the id with `lms:` so the client can distinguish
  // read-only mirrored files from their own uploads.
  if (subjectId) {
    const lmsFiles = await prisma.lmsFile.findMany({
      where: {
        userId: user.id,
        course: { localSubjectId: subjectId },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        externalUrl: true,
      },
    });
    const projected = lmsFiles
      .filter((f) => f.externalUrl)
      .map((f) => ({
        id: `lms:${f.id}`,
        filename: f.filename,
        mimeType: f.mimeType ?? 'application/octet-stream',
        sizeBytes: f.sizeBytes ?? 0,
        url: f.externalUrl!,
      }));
    return ok([...projected, ...assets]);
  }

  return ok(assets);
});
