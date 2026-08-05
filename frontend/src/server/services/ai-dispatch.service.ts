import 'server-only';
import { AssignmentStatus, Priority, ScheduleBlockType } from '@prisma/client';
import { z } from 'zod';
import { generateJson } from './gemini.service';
import { createAssignment } from './assignment.service';
import { createBlock } from './schedule.service';
import { prisma } from '@/server/db';

/**
 * Natural-language dispatcher. Parses one utterance like
 *   "Study calculus tomorrow from 7pm for 90 minutes"
 * into a set of concrete records (assignments, schedule blocks) and creates
 * them in a single call. Uses Gemini's structured-output mode so the reply is
 * a validated JSON payload rather than free text we then have to re-parse.
 */

// ---- Schemas -------------------------------------------------------------
// A single Gemini schema drives both the request-side constraint and the
// zod validation of the reply, so the model can't return fields we don't
// know how to consume.

const isoDateTime = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Not a valid ISO datetime');

const plannedAssignment = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  dueAt: isoDateTime.optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  subjectHint: z.string().max(120).optional().nullable(),
  estimatedMinutes: z.number().int().min(5).max(24 * 60).optional().nullable(),
});

const plannedBlock = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(['CLASS', 'STUDY', 'FOCUS', 'EXAM', 'BREAK', 'PERSONAL']).default('STUDY'),
  startAt: isoDateTime,
  endAt: isoDateTime,
  location: z.string().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  subjectHint: z.string().max(120).optional().nullable(),
});

const plannedNotification = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(500).optional().nullable(),
});

const dispatchPlan = z.object({
  assignments: z.array(plannedAssignment).default([]),
  blocks: z.array(plannedBlock).default([]),
  notifications: z.array(plannedNotification).default([]),
  summary: z.string().min(1).max(500),
});

export type DispatchPlan = z.infer<typeof dispatchPlan>;

/** JSON-schema mirror used to constrain the Gemini response. */
const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          dueAt: { type: 'string', description: 'ISO 8601 datetime' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          subjectHint: { type: 'string' },
          estimatedMinutes: { type: 'integer' },
        },
        required: ['title'],
      },
    },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          type: {
            type: 'string',
            enum: ['CLASS', 'STUDY', 'FOCUS', 'EXAM', 'BREAK', 'PERSONAL'],
          },
          startAt: { type: 'string', description: 'ISO 8601 datetime' },
          endAt: { type: 'string', description: 'ISO 8601 datetime' },
          location: { type: 'string' },
          notes: { type: 'string' },
          subjectHint: { type: 'string' },
        },
        required: ['title', 'startAt', 'endAt'],
      },
    },
    notifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['title'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['summary'],
};

// ---- Plan → records ------------------------------------------------------

async function resolveSubjectId(userId: string, hint: string | null | undefined): Promise<string | null> {
  if (!hint) return null;
  const cleaned = hint.trim();
  if (!cleaned) return null;
  const subject = await prisma.subject.findFirst({
    where: {
      userId,
      archived: false,
      OR: [
        { name: { equals: cleaned, mode: 'insensitive' } },
        { name: { contains: cleaned, mode: 'insensitive' } },
        { code: { equals: cleaned, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });
  return subject?.id ?? null;
}

export interface DispatchResult {
  summary: string;
  createdAssignments: { id: string; title: string }[];
  createdBlocks: { id: string; title: string; startAt: string }[];
  createdNotifications: { id: string; title: string }[];
  /** Non-fatal problems (e.g. an overlapping block that was skipped). */
  warnings: string[];
}

export async function runDispatch(userId: string, text: string): Promise<DispatchResult> {
  const now = new Date();
  const prompt =
    `You are a scheduling assistant for a student. Turn the request below into a JSON plan. ` +
    `Rules:\n` +
    `- Assume the student's local time zone is UTC unless the request states otherwise.\n` +
    `- Interpret dates relative to "now" = ${now.toISOString()}.\n` +
    `- Emit ISO 8601 datetimes with an explicit "Z" suffix.\n` +
    `- Only include the arrays you actually need. Leave the rest empty.\n` +
    `- If the request asks to "study X", produce a schedule block of type STUDY, not an assignment.\n` +
    `- If it names a real deliverable ("essay due Friday", "lab report"), emit an assignment.\n` +
    `- Never guess subjectHint — leave it out when unclear.\n\n` +
    `Request:\n${text}`;

  const generated = await generateJson({
    messages: [{ role: 'user', content: prompt }],
    responseSchema: RESPONSE_SCHEMA,
    tier: 'flash',
    parse: (value) => dispatchPlan.parse(value),
    maxOutputTokens: 2048,
  });

  const plan = generated.data;
  const result: DispatchResult = {
    summary: plan.summary,
    createdAssignments: [],
    createdBlocks: [],
    createdNotifications: [],
    warnings: [],
  };

  for (const item of plan.assignments) {
    try {
      const subjectId = await resolveSubjectId(userId, item.subjectHint);
      const assignment = await createAssignment(userId, {
        title: item.title,
        description: item.description ?? undefined,
        subjectId: subjectId ?? undefined,
        status: AssignmentStatus.TODO,
        priority: (item.priority as Priority | undefined) ?? Priority.MEDIUM,
        dueAt: item.dueAt ? new Date(item.dueAt) : undefined,
        estimatedMinutes: item.estimatedMinutes ?? undefined,
        labels: ['dispatched'],
      });
      result.createdAssignments.push({ id: assignment.id, title: assignment.title });
    } catch (error) {
      result.warnings.push(
        `Couldn't create assignment "${item.title}": ${(error as Error).message}`,
      );
    }
  }

  for (const item of plan.blocks) {
    try {
      const subjectId = await resolveSubjectId(userId, item.subjectHint);
      const block = await createBlock(userId, {
        title: item.title,
        type: (item.type as ScheduleBlockType | undefined) ?? ScheduleBlockType.STUDY,
        startAt: new Date(item.startAt),
        endAt: new Date(item.endAt),
        location: item.location ?? undefined,
        notes: item.notes ?? undefined,
        subjectId: subjectId ?? undefined,
        // Overlap resolution: the dispatcher is a low-friction path, so we
        // permit overlaps and surface a warning rather than reject.
        allowOverlap: true,
      });
      result.createdBlocks.push({
        id: block.id,
        title: block.title,
        startAt: block.startAt.toISOString(),
      });
    } catch (error) {
      result.warnings.push(
        `Couldn't create schedule block "${item.title}": ${(error as Error).message}`,
      );
    }
  }

  for (const item of plan.notifications) {
    try {
      const notification = await prisma.notification.create({
        data: {
          userId,
          type: 'SYSTEM',
          title: item.title,
          body: item.body ?? null,
        },
        select: { id: true, title: true },
      });
      result.createdNotifications.push(notification);
    } catch (error) {
      result.warnings.push(
        `Couldn't create notification "${item.title}": ${(error as Error).message}`,
      );
    }
  }

  return result;
}
