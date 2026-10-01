import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/lib/auth';
import { readQuery, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { prisma } from '@/server/db';

/**
 * GET /api/v1/mind-maps/library-extended
 *
 * Extends the existing /library endpoint with Knowledge Base documents and
 * synced LMS courses so the AI Generate dialog can offer them as sources.
 * Kept as a separate route so the tiny /library endpoint (used by the
 * library-picker panel) stays untouched and cache-friendly.
 */
const querySchema = z.object({
  search: z.string().max(120).optional(),
});

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { search } = readQuery(req, querySchema);
  const like = search ? { contains: search, mode: 'insensitive' as const } : undefined;

  const [documents, lmsCourses, courseFiles] = await Promise.all([
    prisma.knowledgeDocument.findMany({
      where: { userId: user.id, ...(like ? { filename: like } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: { id: true, filename: true, collectionId: true, sizeBytes: true },
    }),
    prisma.lmsCourse.findMany({
      where: {
        connection: { userId: user.id },
        ...(like ? { name: like } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: { id: true, name: true, code: true, localSubjectId: true },
    }),
    // LMS-synced files that already finished ingestion — show them grouped
    // under their course so a student can pick "the slides from week 3"
    // without having to remember a filename.
    prisma.lmsFile.findMany({
      where: {
        userId: user.id,
        knowledgeDocumentId: { not: null },
        ...(like ? { filename: like } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        filename: true,
        knowledgeDocumentId: true,
        course: { select: { name: true, code: true } },
      },
    }),
  ]);

  return ok({
    documents,
    lmsCourses,
    courseFiles: courseFiles
      .filter((f) => f.knowledgeDocumentId)
      .map((f) => ({
        id: f.knowledgeDocumentId!,
        filename: f.filename,
        courseName: f.course.name,
        courseCode: f.course.code,
      })),
  });
});
