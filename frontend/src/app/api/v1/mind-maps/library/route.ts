import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/lib/auth';
import { readQuery, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { prisma } from '@/server/db';

/**
 * Small aggregate endpoint used by the "Add from library" panel in the mind
 * map editor. Returns a bounded list of the user's subjects, notes and
 * assignments so students can drop existing items in as nodes without a
 * separate round-trip per module.
 */
const querySchema = z.object({
  search: z.string().max(120).optional(),
});

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { search } = readQuery(req, querySchema);

  const like = search ? { contains: search, mode: 'insensitive' as const } : undefined;

  const [subjects, notes, assignments] = await Promise.all([
    prisma.subject.findMany({
      where: {
        userId: user.id,
        archived: false,
        ...(like ? { name: like } : {}),
      },
      orderBy: { name: 'asc' },
      take: 50,
      select: { id: true, name: true, color: true, code: true },
    }),
    prisma.note.findMany({
      where: {
        userId: user.id,
        deletedAt: null,
        ...(like ? { title: like } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: { id: true, title: true, subjectId: true, excerpt: true },
    }),
    prisma.assignment.findMany({
      where: {
        userId: user.id,
        deletedAt: null,
        ...(like ? { title: like } : {}),
      },
      orderBy: [{ dueAt: 'asc' }, { updatedAt: 'desc' }],
      take: 30,
      select: {
        id: true,
        title: true,
        subjectId: true,
        status: true,
        dueAt: true,
      },
    }),
  ]);

  return ok({ subjects, notes, assignments });
});
