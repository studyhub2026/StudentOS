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
 * Fast-path lookup for today's brief. Returns whatever the DB has for the
 * user right now (today's row, or yesterday's if today hasn't been generated
 * yet), without ever calling Gemini. Used on the critical path so the
 * dashboard never waits for the AI.
 */
export async function getExistingBrief(userId: string): Promise<DailyBriefContent | null> {
  const date = todayDate();
  const today = await prisma.dailyBrief.findUnique({
    where: { userId_date: { userId, date } },
    select: { content: true },
  });
  if (today) return today.content as unknown as DailyBriefContent;

  // Fall back to the most recent brief so the widget isn't blank on the
  // first request of a new day — the fresh one will arrive on the next poll.
  const previous = await prisma.dailyBrief.findFirst({
    where: { userId },
    orderBy: { date: 'desc' },
    select: { content: true },
  });
  return (previous?.content as unknown as DailyBriefContent) ?? null;
}

/**
 * Per-user, per-day lock so two simultaneous dashboard loads don't fire two
 * Gemini requests. In-process only (per-Function instance on Vercel) — the
 * DB upsert de-dupes across instances.
 */
const generationLocks = new Map<string, Promise<void>>();
function lockKey(userId: string, date: Date): string {
  return `${userId}:${date.getTime()}`;
}

/**
 * Generate today's brief in the background if it doesn't exist yet. Returns
 * synchronously — the actual work runs in a detached Promise so the caller
 * (typically the /ai/brief route) can respond immediately.
 *
 * On success the DB is updated; the client will pick up the new content on
 * its next poll (React Query on the dashboard refetches every 30 s while
 * the current value is stale).
 */
export function ensureTodayBriefAsync(userId: string): void {
  if (!geminiService.isConfigured()) return;

  const date = todayDate();
  const key = lockKey(userId, date);
  if (generationLocks.has(key)) return;

  // Fire and forget. Errors are logged, never surfaced to the caller — the
  // dashboard falls back to yesterday's brief and shows a subtle "generating"
  // state.
  const task = (async () => {
    try {
      // Cheap existence check first — if another Function instance already
      // wrote it, don't burn tokens.
      const existing = await prisma.dailyBrief.findUnique({
        where: { userId_date: { userId, date } },
        select: { userId: true },
      });
      if (existing) return;

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
        messages: [
          { role: 'user', content: `Write today's brief from this data:\n\n${buildContext(overview, memory)}` },
        ],
        responseSchema: BRIEF_SCHEMA as unknown as Record<string, unknown>,
        parse: (value) => briefSchema.parse(value),
      });

      const content: DailyBriefContent = { ...result.data, generatedAt: new Date().toISOString() };

      await prisma.dailyBrief.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, content: content as unknown as object },
        update: { content: content as unknown as object },
      });
    } catch (error) {
      logger.warn({ err: error, userId }, 'daily brief generation failed');
    } finally {
      generationLocks.delete(key);
    }
  })();
  generationLocks.set(key, task);
}

/**
 * Legacy signature retained so callers that expect the whole thing in one
 * step (tests, worker jobs) keep working. Now always non-blocking on the
 * response path: returns whatever the DB has and schedules regeneration in
 * the background if today's row is missing.
 */
export async function getOrCreateTodayBrief(userId: string): Promise<DailyBriefContent | null> {
  const existing = await getExistingBrief(userId);
  // Only trigger regeneration when today's row is genuinely missing — if we
  // returned yesterday's brief we still need today's.
  const date = todayDate();
  const hasToday = await prisma.dailyBrief.findUnique({
    where: { userId_date: { userId, date } },
    select: { userId: true },
  });
  if (!hasToday) ensureTodayBriefAsync(userId);
  return existing;
}

export const aiBriefService = { getOrCreateTodayBrief, getExistingBrief, ensureTodayBriefAsync };
