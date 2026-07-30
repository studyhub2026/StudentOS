import 'server-only';
import { AssignmentStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { assignmentService } from '@/server/services/assignment.service';

/**
 * Aggregates for the dashboard overview. Every figure is derived from live
 * tables rather than a cached snapshot, so the numbers cannot drift out of
 * sync with the underlying records.
 */

export interface StudyTrendPoint {
  date: string;
  studyMinutes: number;
  assignmentsCompleted: number;
  productivityScore: number;
}

export interface SubjectBreakdown {
  subjectId: string;
  name: string;
  color: string;
  studyMinutes: number;
  assignmentCount: number;
  completedCount: number;
}

export interface DashboardOverview {
  stats: {
    studyMinutesToday: number;
    studyMinutesWeek: number;
    currentStreak: number;
    longestStreak: number;
    totalXp: number;
    productivityScore: number;
    focusSessionsToday: number;
    cardsDueToday: number;
  };
  assignments: Awaited<ReturnType<typeof assignmentService.getStats>>;
  upcoming: Awaited<ReturnType<typeof assignmentService.listAssignments>>['items'];
  todaySchedule: {
    id: string;
    title: string;
    type: string;
    startAt: Date;
    endAt: Date;
    location: string | null;
    color: string | null;
    subject: { name: string; color: string } | null;
  }[];
  trend: StudyTrendPoint[];
  subjectBreakdown: SubjectBreakdown[];
}

const TERMINAL: AssignmentStatus[] = [
  AssignmentStatus.COMPLETED,
  AssignmentStatus.SUBMITTED,
];

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function toDateKey(date: Date): string {
  // Local-date key (not toISOString) so a session at 23:00 lands on the day
  // the student actually studied.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function getOverview(userId: string, trendDays = 14): Promise<DashboardOverview> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const weekStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
  const trendStart = new Date(todayStart.getTime() - (trendDays - 1) * 24 * 60 * 60 * 1000);

  const [
    user,
    assignments,
    upcoming,
    todaySchedule,
    todaySessions,
    weekSessions,
    dailyStats,
    cardsDue,
    subjects,
    subjectSessions,
    subjectAssignments,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { currentStreak: true, longestStreak: true, totalXp: true },
    }),

    assignmentService.getStats(userId),

    assignmentService.listAssignments(userId, {
      page: 1,
      limit: 5,
      sortBy: 'dueAt',
      sortOrder: 'asc',
      includeCompleted: false,
      includeArchived: false,
      dueAfter: now,
    } as Parameters<typeof assignmentService.listAssignments>[1]),

    prisma.scheduleBlock.findMany({
      where: { userId, startAt: { gte: todayStart, lt: tomorrowStart } },
      orderBy: { startAt: 'asc' },
      select: {
        id: true,
        title: true,
        type: true,
        startAt: true,
        endAt: true,
        location: true,
        color: true,
        subject: { select: { name: true, color: true } },
      },
    }),

    prisma.studySession.aggregate({
      where: { userId, startedAt: { gte: todayStart } },
      _sum: { durationSeconds: true },
      _count: { _all: true },
    }),

    prisma.studySession.aggregate({
      where: { userId, startedAt: { gte: weekStart } },
      _sum: { durationSeconds: true },
    }),

    prisma.dailyStat.findMany({
      where: { userId, date: { gte: trendStart } },
      orderBy: { date: 'asc' },
    }),

    prisma.flashcard.count({
      where: { deck: { userId }, dueAt: { lte: now } },
    }),

    prisma.subject.findMany({
      where: { userId, archived: false },
      select: { id: true, name: true, color: true },
    }),

    prisma.studySession.groupBy({
      by: ['subjectId'],
      where: { userId, startedAt: { gte: trendStart }, subjectId: { not: null } },
      _sum: { durationSeconds: true },
    }),

    prisma.assignment.groupBy({
      by: ['subjectId', 'status'],
      where: { userId, deletedAt: null, subjectId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  // Fill gaps so the chart renders a continuous axis instead of skipping days
  // with no activity.
  const statsByDate = new Map(dailyStats.map((row) => [toDateKey(row.date), row] as const));
  const trend: StudyTrendPoint[] = [];
  for (let offset = trendDays - 1; offset >= 0; offset -= 1) {
    const day = new Date(todayStart.getTime() - offset * 24 * 60 * 60 * 1000);
    const key = toDateKey(day);
    const row = statsByDate.get(key);
    trend.push({
      date: key,
      studyMinutes: Math.round((row?.studySeconds ?? 0) / 60),
      assignmentsCompleted: row?.assignmentsCompleted ?? 0,
      productivityScore: row?.productivityScore ?? 0,
    });
  }

  const minutesBySubject = new Map(
    subjectSessions.map(
      (row) => [row.subjectId, Math.round((row._sum.durationSeconds ?? 0) / 60)] as const,
    ),
  );

  const subjectBreakdown: SubjectBreakdown[] = subjects.map((subject) => {
    const rows = subjectAssignments.filter((row) => row.subjectId === subject.id);
    return {
      subjectId: subject.id,
      name: subject.name,
      color: subject.color,
      studyMinutes: minutesBySubject.get(subject.id) ?? 0,
      assignmentCount: rows.reduce((sum, row) => sum + row._count._all, 0),
      completedCount: rows
        .filter((row) => TERMINAL.includes(row.status))
        .reduce((sum, row) => sum + row._count._all, 0),
    };
  });

  const studyMinutesToday = Math.round((todaySessions._sum.durationSeconds ?? 0) / 60);

  return {
    stats: {
      studyMinutesToday,
      studyMinutesWeek: Math.round((weekSessions._sum.durationSeconds ?? 0) / 60),
      currentStreak: user?.currentStreak ?? 0,
      longestStreak: user?.longestStreak ?? 0,
      totalXp: user?.totalXp ?? 0,
      productivityScore: computeProductivityScore({
        studyMinutesToday,
        overdue: assignments.overdue,
        completionRate: assignments.completionRate,
      }),
      focusSessionsToday: todaySessions._count._all,
      cardsDueToday: cardsDue,
    },
    assignments,
    upcoming: upcoming.items,
    todaySchedule,
    trend,
    subjectBreakdown,
  };
}

/**
 * A 0–100 blend of today's effort, overall follow-through, and a penalty for
 * work already past its deadline. Deliberately simple and explainable — a
 * student should be able to tell why the number moved.
 */
function computeProductivityScore(input: {
  studyMinutesToday: number;
  overdue: number;
  completionRate: number;
}): number {
  const effort = Math.min(input.studyMinutesToday / 120, 1) * 50;
  const followThrough = (input.completionRate / 100) * 50;
  const penalty = Math.min(input.overdue * 5, 25);
  return Math.max(0, Math.min(100, Math.round(effort + followThrough - penalty)));
}

export const dashboardService = { getOverview } as const;
