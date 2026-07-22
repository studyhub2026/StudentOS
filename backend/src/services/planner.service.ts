import { ScheduleBlockType } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { geminiService } from './gemini.service.js';
import {
  allocateSessions,
  findFreeSlots,
  type AllocatedSession,
  type StudyTask,
  type TimeBlock,
} from './scheduling.js';
import type { GeneratePlanInput } from '../validators/schedule.validator.js';

/**
 * The AI study planner.
 *
 * Slot allocation is done deterministically by `scheduling.ts` — the model is
 * never asked to do arithmetic on times, which it does unreliably. Gemini is
 * used only for the part it is good at: explaining the plan and suggesting an
 * order of attack. If the AI is unavailable the plan is still produced, just
 * without the commentary.
 */

export interface StudyPlan {
  generatedAt: string;
  range: { from: string; to: string };
  sessions: (AllocatedSession & { date: string })[];
  unscheduled: { id: string; title: string; estimatedMinutes: number }[];
  totalMinutes: number;
  /** Null when Gemini is unconfigured or errored — the plan still stands. */
  advice: string | null;
  aiModel: string | null;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Builds the daily availability window from the user's preferred hours. */
function dailyWindow(day: Date, startHour: number, endHour: number): TimeBlock {
  const startAt = new Date(day);
  startAt.setHours(startHour, 0, 0, 0);
  const endAt = new Date(day);
  endAt.setHours(endHour, 0, 0, 0);
  return { startAt, endAt };
}

export async function generatePlan(
  userId: string,
  input: GeneratePlanInput,
): Promise<StudyPlan> {
  const from = startOfDay(input.from ?? new Date());
  const to = new Date(from.getTime() + input.days * 24 * 60 * 60 * 1000);

  const [assignments, commitments, settings] = await Promise.all([
    prisma.assignment.findMany({
      where: {
        userId,
        deletedAt: null,
        status: { notIn: ['COMPLETED', 'SUBMITTED', 'ARCHIVED'] },
      },
      select: {
        id: true,
        title: true,
        estimatedMinutes: true,
        actualMinutes: true,
        dueAt: true,
        priority: true,
        subjectId: true,
        subject: { select: { name: true } },
      },
    }),

    // Existing calendar entries are treated as immovable.
    prisma.scheduleBlock.findMany({
      where: { userId, startAt: { gte: from, lt: to } },
      select: { startAt: true, endAt: true },
    }),

    prisma.userSettings.findUnique({
      where: { userId },
      select: { pomodoroWorkMinutes: true, pomodoroBreakMinutes: true },
    }),
  ]);

  const tasks: StudyTask[] = assignments.map((assignment) => ({
    id: assignment.id,
    title: assignment.title,
    // Remaining work, not total — time already logged should not be replanned.
    estimatedMinutes: Math.max(
      15,
      (assignment.estimatedMinutes ?? 60) - assignment.actualMinutes,
    ),
    dueAt: assignment.dueAt,
    priority: assignment.priority,
    subjectId: assignment.subjectId,
  }));

  // Collect free time across every day in the range.
  const freeSlots: TimeBlock[] = [];
  for (let offset = 0; offset < input.days; offset += 1) {
    const day = new Date(from.getTime() + offset * 24 * 60 * 60 * 1000);
    const window = dailyWindow(day, input.dayStartHour, input.dayEndHour);
    freeSlots.push(...findFreeSlots(window, commitments, input.minSessionMinutes));
  }

  const { sessions, unscheduled } = allocateSessions(tasks, freeSlots, {
    maxSessionMinutes: input.maxSessionMinutes,
    minSessionMinutes: input.minSessionMinutes,
    breakMinutes: settings?.pomodoroBreakMinutes ?? 10,
  });

  const plan: StudyPlan = {
    generatedAt: new Date().toISOString(),
    range: { from: toDateKey(from), to: toDateKey(new Date(to.getTime() - 1)) },
    sessions: sessions.map((session) => ({ ...session, date: toDateKey(session.startAt) })),
    unscheduled: unscheduled.map((task) => ({
      id: task.id,
      title: task.title,
      estimatedMinutes: task.estimatedMinutes,
    })),
    totalMinutes: sessions.reduce((sum, session) => sum + session.minutes, 0),
    advice: null,
    aiModel: null,
  };

  if (input.includeAdvice && geminiService.isConfigured()) {
    const commentary = await describePlan(plan, assignments.length);
    plan.advice = commentary.advice;
    plan.aiModel = commentary.model;
  }

  return plan;
}

/** Asks Gemini to comment on an already-computed plan. Failures are non-fatal. */
async function describePlan(
  plan: StudyPlan,
  totalTasks: number,
): Promise<{ advice: string | null; model: string | null }> {
  const summary = plan.sessions
    .slice(0, 40)
    .map(
      (session) =>
        `${session.date} ${session.startAt.toISOString().slice(11, 16)}–${session.endAt
          .toISOString()
          .slice(11, 16)}: ${session.title} (${session.minutes}m)`,
    )
    .join('\n');

  try {
    const result = await geminiService.generateFromPrompt(
      [
        `A study plan has been generated covering ${plan.range.from} to ${plan.range.to}.`,
        `It schedules ${plan.totalMinutes} minutes across ${plan.sessions.length} sessions for ${totalTasks} outstanding tasks.`,
        plan.unscheduled.length > 0
          ? `These could not be fitted: ${plan.unscheduled.map((task) => task.title).join(', ')}.`
          : 'Everything was scheduled.',
        '',
        summary,
        '',
        'In 3–4 sentences, give the student practical advice on approaching this week.',
        'Mention anything that looks unrealistic. Be direct and encouraging, not effusive.',
      ].join('\n'),
      { temperature: 0.7, maxOutputTokens: 400 },
    );

    return { advice: result.text, model: result.model };
  } catch {
    // The deterministic plan is the product; advice is a bonus.
    return { advice: null, model: null };
  }
}

/** Writes a generated plan into the calendar as real schedule blocks. */
export async function applyPlan(
  userId: string,
  sessions: { taskId: string; title: string; startAt: Date; endAt: Date; subjectId?: string | null }[],
): Promise<number> {
  if (sessions.length === 0) return 0;

  // Only accept assignments the caller actually owns.
  const owned = await prisma.assignment.findMany({
    where: { id: { in: sessions.map((s) => s.taskId) }, userId, deletedAt: null },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((entry) => entry.id));

  const valid = sessions.filter((session) => ownedIds.has(session.taskId));
  if (valid.length === 0) return 0;

  const result = await prisma.scheduleBlock.createMany({
    data: valid.map((session) => ({
      userId,
      title: session.title,
      type: ScheduleBlockType.STUDY,
      startAt: session.startAt,
      endAt: session.endAt,
      assignmentId: session.taskId,
      subjectId: session.subjectId ?? null,
      aiGenerated: true,
    })),
  });

  return result.count;
}

/** Removes previously generated blocks so a plan can be regenerated cleanly. */
export async function clearGeneratedBlocks(
  userId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const result = await prisma.scheduleBlock.deleteMany({
    where: { userId, aiGenerated: true, locked: false, startAt: { gte: from, lt: to } },
  });
  return result.count;
}

export const plannerService = { generatePlan, applyPlan, clearGeneratedBlocks } as const;
