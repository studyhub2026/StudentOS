import 'server-only';
import { Prisma, type StudySessionType } from '@prisma/client';
import { prisma } from '@/server/db';
import { BadRequestError, NotFoundError } from '@/server/lib/errors';
import { calculateStreak } from '@/server/services/scheduling';

/**
 * Focus / Pomodoro sessions.
 *
 * Duration is computed server-side from the recorded timestamps rather than
 * trusted from the client, so a tampered request cannot inflate study stats.
 */

const sessionInclude = {
  subject: { select: { id: true, name: true, color: true } },
  assignment: { select: { id: true, title: true } },
} satisfies Prisma.StudySessionInclude;

export type SessionWithRelations = Prisma.StudySessionGetPayload<{
  include: typeof sessionInclude;
}>;

/** Upper bound on a single session, guarding against a timer left running. */
const MAX_SESSION_SECONDS = 8 * 60 * 60;

export async function startSession(
  userId: string,
  input: {
    type: StudySessionType;
    subjectId?: string | null;
    assignmentId?: string | null;
    ambientSound?: string | null;
  },
): Promise<SessionWithRelations> {
  // Close any session left open — a student who closed the tab mid-session
  // should not have it silently accumulate hours.
  await closeAbandonedSessions(userId);

  if (input.subjectId) {
    const subject = await prisma.subject.findFirst({
      where: { id: input.subjectId, userId },
      select: { id: true },
    });
    if (!subject) throw new BadRequestError('That subject does not exist');
  }

  return prisma.studySession.create({
    data: {
      userId,
      type: input.type,
      subjectId: input.subjectId ?? null,
      assignmentId: input.assignmentId ?? null,
      ambientSound: input.ambientSound ?? null,
      startedAt: new Date(),
    },
    include: sessionInclude,
  });
}

export async function getActiveSession(userId: string): Promise<SessionWithRelations | null> {
  return prisma.studySession.findFirst({
    where: { userId, endedAt: null },
    orderBy: { startedAt: 'desc' },
    include: sessionInclude,
  });
}

export async function endSession(
  userId: string,
  sessionId: string,
  input: { completed: boolean; interruptions?: number; notes?: string | null },
): Promise<SessionWithRelations> {
  const session = await prisma.studySession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true, startedAt: true, endedAt: true, subjectId: true },
  });
  if (!session) throw new NotFoundError('Session');
  if (session.endedAt) throw new BadRequestError('That session has already ended');

  const endedAt = new Date();
  const durationSeconds = Math.min(
    MAX_SESSION_SECONDS,
    Math.max(0, Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000)),
  );

  const updated = await prisma.studySession.update({
    where: { id: sessionId },
    data: {
      endedAt,
      durationSeconds,
      completed: input.completed,
      interruptions: input.interruptions ?? 0,
      notes: input.notes ?? null,
      focusScore: computeFocusScore(durationSeconds, input.interruptions ?? 0),
    },
    include: sessionInclude,
  });

  await rollUpDailyStats(userId, endedAt);
  await refreshStreak(userId);

  return updated;
}

export async function cancelSession(userId: string, sessionId: string): Promise<void> {
  const result = await prisma.studySession.deleteMany({
    where: { id: sessionId, userId, endedAt: null },
  });
  if (result.count === 0) throw new NotFoundError('Active session');
}

/**
 * Ends sessions left open for longer than the maximum, recording the elapsed
 * time capped rather than discarding it.
 */
async function closeAbandonedSessions(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_SESSION_SECONDS * 1000);

  const abandoned = await prisma.studySession.findMany({
    where: { userId, endedAt: null, startedAt: { lt: cutoff } },
    select: { id: true, startedAt: true },
  });

  for (const session of abandoned) {
    await prisma.studySession.update({
      where: { id: session.id },
      data: {
        endedAt: new Date(session.startedAt.getTime() + MAX_SESSION_SECONDS * 1000),
        durationSeconds: MAX_SESSION_SECONDS,
        completed: false,
        notes: 'Automatically closed — session exceeded the maximum length',
      },
    });
  }

  // Any remaining open session is simply superseded by the new one.
  await prisma.studySession.updateMany({
    where: { userId, endedAt: null },
    data: { endedAt: new Date(), completed: false },
  });
}

/**
 * 0–100 blend of sustained time and freedom from interruption. A 25-minute
 * uninterrupted pomodoro scores 100.
 */
function computeFocusScore(durationSeconds: number, interruptions: number): number {
  const minutes = durationSeconds / 60;
  const lengthScore = Math.min(minutes / 25, 1) * 100;
  const penalty = Math.min(interruptions * 12, 60);
  return Math.max(0, Math.round(lengthScore - penalty));
}

/** Recomputes the DailyStat row for the given day from source records. */
export async function rollUpDailyStats(userId: string, when: Date): Promise<void> {
  const dayStart = new Date(when);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [sessions, assignments, reviews, notes] = await Promise.all([
    prisma.studySession.aggregate({
      where: { userId, startedAt: { gte: dayStart, lt: dayEnd }, endedAt: { not: null } },
      _sum: { durationSeconds: true },
      _count: { _all: true },
    }),
    prisma.assignment.count({
      where: { userId, completedAt: { gte: dayStart, lt: dayEnd } },
    }),
    prisma.flashcardReview.count({
      where: { userId, reviewedAt: { gte: dayStart, lt: dayEnd } },
    }),
    prisma.note.count({
      where: { userId, createdAt: { gte: dayStart, lt: dayEnd } },
    }),
  ]);

  const focusOnly = await prisma.studySession.aggregate({
    where: {
      userId,
      startedAt: { gte: dayStart, lt: dayEnd },
      type: { in: ['POMODORO', 'DEEP_WORK'] },
      endedAt: { not: null },
    },
    _sum: { durationSeconds: true },
  });

  const studySeconds = sessions._sum.durationSeconds ?? 0;
  const xp = Math.round(studySeconds / 60) + assignments * 25 + reviews * 2;

  await prisma.dailyStat.upsert({
    where: { userId_date: { userId, date: dayStart } },
    create: {
      userId,
      date: dayStart,
      studySeconds,
      focusSeconds: focusOnly._sum.durationSeconds ?? 0,
      sessionsCompleted: sessions._count._all,
      assignmentsCompleted: assignments,
      cardsReviewed: reviews,
      notesCreated: notes,
      productivityScore: scoreDay(studySeconds, assignments, reviews),
      xpEarned: xp,
    },
    update: {
      studySeconds,
      focusSeconds: focusOnly._sum.durationSeconds ?? 0,
      sessionsCompleted: sessions._count._all,
      assignmentsCompleted: assignments,
      cardsReviewed: reviews,
      notesCreated: notes,
      productivityScore: scoreDay(studySeconds, assignments, reviews),
      xpEarned: xp,
    },
  });
}

function scoreDay(studySeconds: number, assignments: number, reviews: number): number {
  const study = Math.min(studySeconds / (120 * 60), 1) * 60;
  const output = Math.min(assignments * 10, 25);
  const revision = Math.min(reviews / 20, 1) * 15;
  return Math.round(Math.min(100, study + output + revision));
}

/** Recomputes the user's streak from their DailyStat history. */
export async function refreshStreak(userId: string): Promise<number> {
  const stats = await prisma.dailyStat.findMany({
    where: { userId, studySeconds: { gt: 0 } },
    orderBy: { date: 'desc' },
    take: 400,
    select: { date: true },
  });

  const toKey = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const streak = calculateStreak(stats.map((row) => toKey(row.date)), toKey(new Date()));

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { longestStreak: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: {
      currentStreak: streak,
      longestStreak: Math.max(streak, user?.longestStreak ?? 0),
      lastActiveDate: new Date(),
    },
  });

  return streak;
}

export async function listSessions(
  userId: string,
  query: { page: number; limit: number; from?: Date | undefined; to?: Date | undefined },
) {
  const where: Prisma.StudySessionWhereInput = {
    userId,
    endedAt: { not: null },
    ...(query.from || query.to
      ? {
          startedAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lt: query.to } : {}),
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.studySession.findMany({
      where,
      include: sessionInclude,
      orderBy: { startedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.studySession.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / query.limit));

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNext: query.page < totalPages,
      hasPrevious: query.page > 1,
    },
  };
}

export const focusService = {
  startSession,
  endSession,
  cancelSession,
  getActiveSession,
  listSessions,
  rollUpDailyStats,
  refreshStreak,
} as const;
