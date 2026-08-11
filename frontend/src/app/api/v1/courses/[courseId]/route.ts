import type { NextRequest } from 'next/server';
import { AssignmentStatus } from '@prisma/client';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { NotFoundError } from '@/server/lib/errors';
import { ok } from '@/server/lib/response';
import { prisma } from '@/server/db';

/**
 * GET /api/v1/courses/:courseId
 *
 * Aggregates data for a single course/subject workspace. Pulls from existing
 * tables — no new models needed.
 */
export const GET = route<{ courseId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { courseId } = params;

  const subject = await prisma.subject.findFirst({
    where: { id: courseId, userId: user.id },
  });
  if (!subject) throw new NotFoundError('Subject');

  const now = new Date();
  const threeMonthsOut = new Date(now);
  threeMonthsOut.setDate(threeMonthsOut.getDate() + 90);

  const [
    assignments,
    notes,
    decks,
    upcomingBlocks,
    grades,
    lmsCourse,
  ] = await Promise.all([
    prisma.assignment.findMany({
      where: { userId: user.id, subjectId: courseId, deletedAt: null },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 30,
      select: {
        id: true, title: true, status: true, priority: true,
        dueAt: true, grade: true, completedAt: true, createdAt: true,
      },
    }),
    prisma.note.findMany({
      where: { userId: user.id, subjectId: courseId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        id: true, title: true, excerpt: true, updatedAt: true,
        favorite: true, pinned: true,
      },
    }),
    prisma.flashcardDeck.findMany({
      where: { userId: user.id, subjectId: courseId },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: {
        _count: { select: { cards: true } },
      },
    }),
    prisma.scheduleBlock.findMany({
      where: {
        userId: user.id, subjectId: courseId,
        startAt: { gte: now, lt: threeMonthsOut },
      },
      orderBy: { startAt: 'asc' },
      take: 20,
      select: {
        id: true, title: true, type: true, startAt: true, endAt: true,
        location: true,
      },
    }),
    prisma.lmsGrade.findMany({
      where: {
        connection: { userId: user.id },
        course: { localSubjectId: courseId },
      },
      orderBy: { postedAt: 'desc' },
      take: 20,
      select: {
        id: true, label: true, score: true, maxScore: true,
        percentage: true, letterGrade: true, postedAt: true,
      },
    }),
    prisma.lmsCourse.findFirst({
      where: { localSubjectId: courseId, connection: { userId: user.id } },
      select: { id: true, name: true, code: true, instructor: true },
    }),
  ]);

  const matchingTutor = await prisma.tutor.findFirst({
    where: {
      userId: user.id,
      subject: { equals: subject.name, mode: 'insensitive' },
    },
    select: { id: true, subjectKey: true, subject: true },
  });

  // Compute stats
  const totalAssignments = assignments.length;
  const completedAssignments = assignments.filter(
    (a) => a.status === AssignmentStatus.COMPLETED || a.status === AssignmentStatus.SUBMITTED,
  ).length;
  const overdueAssignments = assignments.filter(
    (a) =>
      a.dueAt &&
      a.dueAt < now &&
      a.status !== AssignmentStatus.COMPLETED &&
      a.status !== AssignmentStatus.SUBMITTED &&
      a.status !== AssignmentStatus.ARCHIVED,
  ).length;
  const averageGrade = assignments.filter((a) => a.grade != null).length > 0
    ? Math.round(
        assignments.filter((a) => a.grade != null).reduce((sum, a) => sum + (a.grade ?? 0), 0) /
        assignments.filter((a) => a.grade != null).length,
      )
    : null;

  const upcomingExams = upcomingBlocks.filter((b) => b.type === 'EXAM');

  return ok({
    subject: {
      id: subject.id,
      name: subject.name,
      code: subject.code,
      color: subject.color,
      icon: subject.icon,
      teacherName: subject.teacherName,
      room: subject.room,
      credits: subject.credits,
      targetGrade: subject.targetGrade,
    },
    lmsCourse,
    stats: {
      totalAssignments,
      completedAssignments,
      overdueAssignments,
      averageGrade,
      notesCount: notes.length,
      decksCount: decks.length,
      upcomingExams: upcomingExams.length,
      totalGrades: grades.length,
    },
    assignments,
    notes,
    decks: decks.map((d) => ({ id: d.id, title: d.name, updatedAt: d.updatedAt, cardCount: d._count.cards })),
    schedule: upcomingBlocks,
    grades,
    tutor: matchingTutor,
  });
});
