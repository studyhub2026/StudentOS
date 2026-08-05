import 'server-only';
import { prisma } from '@/server/db';

/**
 * Lightweight aggregator for the Exam Mode workspace. Everything here reads
 * from tables that already exist — ScheduleBlock (type=EXAM), Subject,
 * TutorProgress (weak topics), Assignment (recent related work). We do NOT
 * introduce a new "Exam" model; upcoming exams ARE just schedule blocks.
 */

export interface UpcomingExam {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  location: string | null;
  minutesToExam: number;
  subject: { id: string; name: string; color: string | null } | null;
}

export interface ExamWorkspaceData {
  upcoming: UpcomingExam[];
  past: UpcomingExam[];
  weakTopicsBySubject: {
    subjectId: string;
    subjectName: string;
    weakTopics: string[];
    masteryScore: number;
    confidenceScore: number;
  }[];
}

export async function getExamWorkspace(userId: string): Promise<ExamWorkspaceData> {
  const now = new Date();
  const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [upcomingBlocks, pastBlocks, tutors] = await Promise.all([
    prisma.scheduleBlock.findMany({
      where: { userId, type: 'EXAM', startAt: { gte: now, lte: in90Days } },
      orderBy: { startAt: 'asc' },
      take: 20,
      select: {
        id: true,
        title: true,
        startAt: true,
        endAt: true,
        location: true,
        subject: { select: { id: true, name: true, color: true } },
      },
    }),
    prisma.scheduleBlock.findMany({
      where: { userId, type: 'EXAM', startAt: { gte: last30, lt: now } },
      orderBy: { startAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        startAt: true,
        endAt: true,
        location: true,
        subject: { select: { id: true, name: true, color: true } },
      },
    }),
    prisma.tutor.findMany({
      where: { userId },
      select: {
        subject: true,
        subjectKey: true,
        progress: {
          select: {
            weakTopics: true,
            masteryScore: true,
            confidenceScore: true,
          },
        },
      },
    }),
  ]);

  const toUpcoming = (b: (typeof upcomingBlocks)[number]): UpcomingExam => ({
    id: b.id,
    title: b.title,
    startAt: b.startAt.toISOString(),
    endAt: b.endAt.toISOString(),
    location: b.location,
    minutesToExam: Math.round((b.startAt.getTime() - now.getTime()) / 60000),
    subject: b.subject,
  });

  return {
    upcoming: upcomingBlocks.map(toUpcoming),
    past: pastBlocks.map(toUpcoming),
    weakTopicsBySubject: tutors
      .filter((t) => (t.progress?.weakTopics.length ?? 0) > 0)
      .map((t) => ({
        subjectId: t.subjectKey,
        subjectName: t.subject,
        weakTopics: t.progress?.weakTopics ?? [],
        masteryScore: t.progress?.masteryScore ?? 0,
        confidenceScore: t.progress?.confidenceScore ?? 0,
      })),
  };
}
