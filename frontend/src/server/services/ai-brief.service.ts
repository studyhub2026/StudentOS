import 'server-only';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { logger } from '@/server/lib/logger';
import { aiMemoryService } from './ai-memory.service';
import { dashboardService } from './dashboard.service';
import { geminiService } from './gemini.service';

export interface DailyBriefContent {
  motivation: string;
  workload: string;
  outlook: string;
  priorities: { title: string; detail: string }[];
  suggestion: string;
  generatedAt: string;
}

/** Midnight UTC today, matching the `@db.Date` column. */
function todayDate(): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

const briefSchema = z.object({
  motivation: z.string().trim().min(1).max(300),
  workload: z.string().trim().min(1).max(200),
  outlook: z.string().trim().min(1).max(200),
  priorities: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        detail: z.string().trim().min(1).max(240),
      }),
    )
    .min(1)
    .max(5),
  suggestion: z.string().trim().min(1).max(240),
});

const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    motivation: { type: 'string' },
    workload: { type: 'string' },
    outlook: { type: 'string' },
    priorities: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, detail: { type: 'string' } },
        required: ['title', 'detail'],
      },
    },
    suggestion: { type: 'string' },
  },
  required: ['motivation', 'workload', 'outlook', 'priorities', 'suggestion'],
} as const;

function buildContext(
  overview: Awaited<ReturnType<typeof dashboardService.getOverview>>,
  memory: string,
): string {
  const s = overview.stats;
  const a = overview.assignments;

  const upcoming =
    overview.upcoming
      .slice(0, 6)
      .map(
        (x) =>
          `- ${x.title} (${x.subject?.name ?? 'no subject'}), due ${x.dueAt ? new Date(x.dueAt).toDateString() : 'no date'}, priority ${x.priority}`,
      )
      .join('\n') || 'none';

  const schedule =
    overview.todaySchedule
      .map(
        (b) =>
          `- ${new Date(b.startAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} ${b.title}`,
      )
      .join('\n') || 'nothing scheduled';

  const subjects =
    overview.subjectBreakdown
      .slice(0, 5)
      .map((x) => `${x.name}: ${x.studyMinutes}min`)
      .join(', ') || 'none logged';

  return [
    `Today: ${new Date().toDateString()}`,
    `Studied today: ${s.studyMinutesToday} min; this week: ${s.studyMinutesWeek} min. Current streak: ${s.currentStreak} days. Productivity score: ${s.productivityScore}/100. Flashcards due: ${s.cardsDueToday}.`,
    `Assignments — total ${a.total}, completed ${a.completed}, due today ${a.dueToday}, due this week ${a.dueThisWeek}, overdue ${a.overdue}. Completion rate ${a.completionRate}%.`,
    `Upcoming assignments:\n${upcoming}`,
    `Today's schedule:\n${schedule}`,
    `Recent time by subject: ${subjects}.`,
    memory ? `\n${memory}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Returns today's brief, generating it once from the student's real data and
 * caching it for the day. Returns null when AI is unconfigured or generation
 * fails, so the dashboard widget simply hides rather than erroring.
 */
export async function getOrCreateTodayBrief(userId: string): Promise<DailyBriefContent | null> {
  if (!geminiService.isConfigured()) return null;

  const date = todayDate();
  const existing = await prisma.dailyBrief.findUnique({
    where: { userId_date: { userId, date } },
  });
  if (existing) return existing.content as unknown as DailyBriefContent;

  try {
    const [overview, memory] = await Promise.all([
      dashboardService.getOverview(userId),
      aiMemoryService.getMemoryContext(userId),
    ]);

    const result = await geminiService.generateJson({
      systemInstruction:
        'You are a warm, sharp personal study coach writing a student’s morning brief. Ground every ' +
        'line in their real data below — priorities must reference their actual assignments or ' +
        'subjects. Be encouraging but honest, specific, and concise. If they are behind, gently say ' +
        'so and give a plan. Never invent data or use markdown. "workload" estimates today’s effort ' +
        '(e.g. "~2 hours across 3 tasks"); "outlook" is a one-line productivity prediction.',
      messages: [{ role: 'user', content: `Write today's brief from this data:\n\n${buildContext(overview, memory)}` }],
      responseSchema: BRIEF_SCHEMA as unknown as Record<string, unknown>,
      parse: (value) => briefSchema.parse(value),
    });

    const content: DailyBriefContent = { ...result.data, generatedAt: new Date().toISOString() };

    await prisma.dailyBrief.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, content: content as unknown as object },
      update: { content: content as unknown as object },
    });

    return content;
  } catch (error) {
    logger.warn({ err: error, userId }, 'daily brief generation failed');
    return null;
  }
}

export const aiBriefService = { getOrCreateTodayBrief };
