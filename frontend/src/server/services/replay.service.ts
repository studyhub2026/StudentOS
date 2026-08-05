import 'server-only';
import { prisma } from '@/server/db';

/**
 * Rolls the student's whole year of activity into ~a dozen numbers the
 * client can hand to a Wrapped-style animation. The frame budget is tight
 * so this must be one round-trip; the queries fan out with Promise.all.
 */

export interface ReplayData {
  year: number;
  totals: {
    studyMinutes: number;
    focusMinutes: number;
    sessions: number;
    assignmentsCompleted: number;
    notesWritten: number;
    flashcardsReviewed: number;
    achievementsUnlocked: number;
    longestStreak: number;
  };
  topSubject: { name: string; color: string | null; minutes: number } | null;
  biggestDay: { date: string; minutes: number } | null;
  favouriteHour: number | null;
  achievements: { name: string; icon: string; tier: string; unlockedAt: string }[];
  monthlyMinutes: { month: number; minutes: number }[];
}

export async function getReplayForYear(userId: string, year: number): Promise<ReplayData> {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));

  const [
    dailyStats,
    subjectTotals,
    assignments,
    notes,
    flashcardReviews,
    achievements,
    sessions,
    user,
  ] = await Promise.all([
    prisma.dailyStat.findMany({
      where: { userId, date: { gte: from, lt: to } },
      select: { date: true, studySeconds: true, focusSeconds: true, sessionsCompleted: true },
    }),
    prisma.studySession.groupBy({
      by: ['subjectId'],
      where: { userId, startedAt: { gte: from, lt: to }, subjectId: { not: null } },
      _sum: { durationSeconds: true },
    }),
    prisma.assignment.count({
      where: { userId, completedAt: { gte: from, lt: to, not: null } },
    }),
    prisma.note.count({
      where: { userId, createdAt: { gte: from, lt: to }, deletedAt: null },
    }),
    prisma.flashcardReview.count({
      where: { userId, reviewedAt: { gte: from, lt: to } },
    }),
    prisma.userAchievement.findMany({
      where: { userId, unlockedAt: { gte: from, lt: to, not: null } },
      orderBy: { unlockedAt: 'desc' },
      select: {
        unlockedAt: true,
        achievement: { select: { name: true, icon: true, tier: true } },
      },
    }),
    prisma.studySession.findMany({
      where: { userId, startedAt: { gte: from, lt: to } },
      select: { startedAt: true, durationSeconds: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { longestStreak: true },
    }),
  ]);

  // Aggregate the daily stats.
  let studySeconds = 0;
  let focusSeconds = 0;
  let sessionCount = 0;
  let biggestDay: { date: string; minutes: number } | null = null;
  const monthlyMinutes = new Array(12).fill(0);
  for (const d of dailyStats) {
    studySeconds += d.studySeconds;
    focusSeconds += d.focusSeconds;
    sessionCount += d.sessionsCompleted;
    const minutes = Math.round(d.studySeconds / 60);
    if (!biggestDay || minutes > biggestDay.minutes) {
      biggestDay = { date: d.date.toISOString().slice(0, 10), minutes };
    }
    monthlyMinutes[d.date.getUTCMonth()] += minutes;
  }

  // Which subject soaked up the most time?
  let topSubject: ReplayData['topSubject'] = null;
  if (subjectTotals.length > 0) {
    const top = subjectTotals.reduce((a, b) =>
      (a._sum.durationSeconds ?? 0) > (b._sum.durationSeconds ?? 0) ? a : b,
    );
    if (top.subjectId) {
      const subject = await prisma.subject.findUnique({
        where: { id: top.subjectId },
        select: { name: true, color: true },
      });
      if (subject) {
        topSubject = {
          name: subject.name,
          color: subject.color,
          minutes: Math.round((top._sum.durationSeconds ?? 0) / 60),
        };
      }
    }
  }

  // "Favourite hour" — histogram of hour-of-day, weighted by session length.
  const hourHistogram = new Array(24).fill(0);
  for (const s of sessions) {
    hourHistogram[s.startedAt.getUTCHours()] += s.durationSeconds;
  }
  const favouriteHour = hourHistogram.some((n) => n > 0)
    ? hourHistogram.indexOf(Math.max(...hourHistogram))
    : null;

  return {
    year,
    totals: {
      studyMinutes: Math.round(studySeconds / 60),
      focusMinutes: Math.round(focusSeconds / 60),
      sessions: sessionCount,
      assignmentsCompleted: assignments,
      notesWritten: notes,
      flashcardsReviewed: flashcardReviews,
      achievementsUnlocked: achievements.length,
      longestStreak: user?.longestStreak ?? 0,
    },
    topSubject,
    biggestDay,
    favouriteHour,
    achievements: achievements.slice(0, 6).map((ua) => ({
      name: ua.achievement.name,
      icon: ua.achievement.icon,
      tier: ua.achievement.tier,
      unlockedAt: (ua.unlockedAt as Date).toISOString(),
    })),
    monthlyMinutes: monthlyMinutes.map((minutes, month) => ({ month, minutes })),
  };
}
