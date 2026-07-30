import 'server-only';
import { AssignmentStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { detectBurnoutRisk } from '@/server/services/scheduling';

/**
 * Study analytics derived from source records at read time. Nothing here is
 * cached, so figures can never drift from the underlying data.
 */

export interface AnalyticsOverview {
  range: { from: string; to: string; days: number };
  totals: {
    studyMinutes: number;
    focusMinutes: number;
    sessions: number;
    assignmentsCompleted: number;
    cardsReviewed: number;
    notesCreated: number;
    xpEarned: number;
  };
  averages: {
    minutesPerDay: number;
    minutesPerActiveDay: number;
    sessionLengthMinutes: number;
    productivityScore: number;
  };
  streak: { current: number; longest: number };
  burnout: { atRisk: boolean; reason: string | null; consecutiveDays: number };
  daily: {
    date: string;
    studyMinutes: number;
    focusMinutes: number;
    assignmentsCompleted: number;
    cardsReviewed: number;
    productivityScore: number;
  }[];
  /** Minutes studied per weekday (0=Sunday) × hour bucket, for the heatmap. */
  weekdayHeatmap: { weekday: number; hour: number; minutes: number }[];
  subjects: {
    subjectId: string;
    name: string;
    color: string;
    studyMinutes: number;
    assignmentsTotal: number;
    assignmentsCompleted: number;
    completionRate: number;
    averageGrade: number | null;
  }[];
  grades: {
    overallAverage: number | null;
    gpa: number | null;
    bySubject: { subjectId: string; name: string; average: number; credits: number | null }[];
  };
  weakSubjects: { subjectId: string; name: string; reason: string }[];
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converts a percentage to a 4.0-scale grade point using the common US
 * mapping. Exposed separately so the rule is easy to see and change.
 */
export function toGradePoint(percentage: number): number {
  if (percentage >= 93) return 4.0;
  if (percentage >= 90) return 3.7;
  if (percentage >= 87) return 3.3;
  if (percentage >= 83) return 3.0;
  if (percentage >= 80) return 2.7;
  if (percentage >= 77) return 2.3;
  if (percentage >= 73) return 2.0;
  if (percentage >= 70) return 1.7;
  if (percentage >= 67) return 1.3;
  if (percentage >= 63) return 1.0;
  if (percentage >= 60) return 0.7;
  return 0;
}

export async function getOverview(userId: string, days: number): Promise<AnalyticsOverview> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const from = new Date(todayStart.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const to = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const [user, dailyStats, sessions, subjects, gradedAssignments, assignmentCounts] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { currentStreak: true, longestStreak: true },
      }),

      prisma.dailyStat.findMany({
        where: { userId, date: { gte: from } },
        orderBy: { date: 'asc' },
      }),

      prisma.studySession.findMany({
        where: { userId, startedAt: { gte: from, lt: to }, endedAt: { not: null } },
        select: { startedAt: true, durationSeconds: true, subjectId: true },
      }),

      prisma.subject.findMany({
        where: { userId, archived: false },
        select: { id: true, name: true, color: true, credits: true },
      }),

      prisma.assignment.findMany({
        where: {
          userId,
          deletedAt: null,
          grade: { not: null },
          maxGrade: { not: null, gt: 0 },
        },
        select: { subjectId: true, grade: true, maxGrade: true, weight: true },
      }),

      prisma.assignment.groupBy({
        by: ['subjectId', 'status'],
        where: { userId, deletedAt: null },
        _count: { _all: true },
      }),
    ]);

  // --- Daily series, gap-filled -------------------------------------------
  const statsByDate = new Map(dailyStats.map((row) => [toDateKey(row.date), row] as const));
  const daily: AnalyticsOverview['daily'] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(todayStart.getTime() - offset * 24 * 60 * 60 * 1000);
    const key = toDateKey(day);
    const row = statsByDate.get(key);
    daily.push({
      date: key,
      studyMinutes: Math.round((row?.studySeconds ?? 0) / 60),
      focusMinutes: Math.round((row?.focusSeconds ?? 0) / 60),
      assignmentsCompleted: row?.assignmentsCompleted ?? 0,
      cardsReviewed: row?.cardsReviewed ?? 0,
      productivityScore: row?.productivityScore ?? 0,
    });
  }

  // --- Totals and averages -------------------------------------------------
  const totals = {
    studyMinutes: daily.reduce((sum, day) => sum + day.studyMinutes, 0),
    focusMinutes: daily.reduce((sum, day) => sum + day.focusMinutes, 0),
    sessions: dailyStats.reduce((sum, row) => sum + row.sessionsCompleted, 0),
    assignmentsCompleted: daily.reduce((sum, day) => sum + day.assignmentsCompleted, 0),
    cardsReviewed: daily.reduce((sum, day) => sum + day.cardsReviewed, 0),
    notesCreated: dailyStats.reduce((sum, row) => sum + row.notesCreated, 0),
    xpEarned: dailyStats.reduce((sum, row) => sum + row.xpEarned, 0),
  };

  const activeDays = daily.filter((day) => day.studyMinutes > 0).length;
  const scored = daily.filter((day) => day.productivityScore > 0);

  const averages = {
    minutesPerDay: Math.round(totals.studyMinutes / days),
    minutesPerActiveDay: activeDays === 0 ? 0 : Math.round(totals.studyMinutes / activeDays),
    sessionLengthMinutes:
      totals.sessions === 0 ? 0 : Math.round(totals.studyMinutes / totals.sessions),
    productivityScore:
      scored.length === 0
        ? 0
        : Math.round(
            scored.reduce((sum, day) => sum + day.productivityScore, 0) / scored.length,
          ),
  };

  // --- Weekday × hour heatmap ---------------------------------------------
  const heatBuckets = new Map<string, number>();
  for (const session of sessions) {
    const weekday = session.startedAt.getDay();
    const hour = session.startedAt.getHours();
    const key = `${weekday}:${hour}`;
    heatBuckets.set(key, (heatBuckets.get(key) ?? 0) + session.durationSeconds / 60);
  }

  const weekdayHeatmap = [...heatBuckets.entries()].map(([key, minutes]) => {
    const [weekday, hour] = key.split(':').map(Number);
    return { weekday: weekday ?? 0, hour: hour ?? 0, minutes: Math.round(minutes) };
  });

  // --- Per-subject rollup --------------------------------------------------
  const minutesBySubject = new Map<string, number>();
  for (const session of sessions) {
    if (!session.subjectId) continue;
    minutesBySubject.set(
      session.subjectId,
      (minutesBySubject.get(session.subjectId) ?? 0) + session.durationSeconds / 60,
    );
  }

  const gradesBySubject = new Map<string, { sum: number; weight: number }>();
  for (const assignment of gradedAssignments) {
    if (!assignment.subjectId || !assignment.maxGrade) continue;
    const percentage = (assignment.grade! / assignment.maxGrade) * 100;
    const weight = assignment.weight ?? 1;
    const entry = gradesBySubject.get(assignment.subjectId) ?? { sum: 0, weight: 0 };
    entry.sum += percentage * weight;
    entry.weight += weight;
    gradesBySubject.set(assignment.subjectId, entry);
  }

  const TERMINAL: AssignmentStatus[] = [
    AssignmentStatus.COMPLETED,
    AssignmentStatus.SUBMITTED,
  ];

  const subjectRows = subjects.map((subject) => {
    const counts = assignmentCounts.filter((row) => row.subjectId === subject.id);
    const total = counts.reduce((sum, row) => sum + row._count._all, 0);
    const completed = counts
      .filter((row) => TERMINAL.includes(row.status))
      .reduce((sum, row) => sum + row._count._all, 0);

    const grade = gradesBySubject.get(subject.id);

    return {
      subjectId: subject.id,
      name: subject.name,
      color: subject.color,
      studyMinutes: Math.round(minutesBySubject.get(subject.id) ?? 0),
      assignmentsTotal: total,
      assignmentsCompleted: completed,
      completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
      averageGrade:
        grade && grade.weight > 0 ? Math.round((grade.sum / grade.weight) * 10) / 10 : null,
    };
  });

  // --- Grades and GPA ------------------------------------------------------
  const graded = subjectRows.filter((row) => row.averageGrade !== null);

  const overallAverage =
    graded.length === 0
      ? null
      : Math.round(
          (graded.reduce((sum, row) => sum + (row.averageGrade ?? 0), 0) / graded.length) * 10,
        ) / 10;

  // Credit-weighted where credits exist; otherwise a simple mean.
  let gpa: number | null = null;
  if (graded.length > 0) {
    let points = 0;
    let credits = 0;
    for (const row of graded) {
      const subject = subjects.find((entry) => entry.id === row.subjectId);
      const weight = subject?.credits ?? 1;
      points += toGradePoint(row.averageGrade ?? 0) * weight;
      credits += weight;
    }
    gpa = credits === 0 ? null : Math.round((points / credits) * 100) / 100;
  }

  // --- Weak subjects -------------------------------------------------------
  // Flags are explainable rather than a black-box score: each names the signal
  // that triggered it.
  const weakSubjects: AnalyticsOverview['weakSubjects'] = [];
  const medianMinutes = median(subjectRows.map((row) => row.studyMinutes));

  for (const row of subjectRows) {
    if (row.averageGrade !== null && row.averageGrade < 65) {
      weakSubjects.push({
        subjectId: row.subjectId,
        name: row.name,
        reason: `Average grade is ${row.averageGrade}%`,
      });
      continue;
    }
    if (row.assignmentsTotal >= 3 && row.completionRate < 50) {
      weakSubjects.push({
        subjectId: row.subjectId,
        name: row.name,
        reason: `Only ${row.completionRate}% of assignments completed`,
      });
      continue;
    }
    if (row.assignmentsTotal > 0 && medianMinutes > 60 && row.studyMinutes < medianMinutes / 3) {
      weakSubjects.push({
        subjectId: row.subjectId,
        name: row.name,
        reason: `Far less study time than your other subjects`,
      });
    }
  }

  return {
    range: { from: toDateKey(from), to: toDateKey(todayStart), days },
    totals,
    averages,
    streak: { current: user?.currentStreak ?? 0, longest: user?.longestStreak ?? 0 },
    burnout: detectBurnoutRisk(daily.map((day) => day.studyMinutes)),
    daily,
    weekdayHeatmap,
    subjects: subjectRows,
    grades: {
      overallAverage,
      gpa,
      bySubject: graded.map((row) => ({
        subjectId: row.subjectId,
        name: row.name,
        average: row.averageGrade ?? 0,
        credits: subjects.find((entry) => entry.id === row.subjectId)?.credits ?? null,
      })),
    },
    weakSubjects,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

export const analyticsService = { getOverview, toGradePoint } as const;
