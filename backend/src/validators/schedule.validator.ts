import { z } from 'zod';

const cuid = z.string().min(1);
const isoDate = z.coerce.date();

const BLOCK_TYPE = ['CLASS', 'STUDY', 'FOCUS', 'EXAM', 'BREAK', 'PERSONAL'] as const;
const SESSION_TYPE = ['POMODORO', 'DEEP_WORK', 'REVIEW', 'CLASS', 'BREAK'] as const;
const RECURRENCE = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;

export const createBlockSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  type: z.enum(BLOCK_TYPE).default('STUDY'),
  startAt: isoDate,
  endAt: isoDate,
  location: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a hex value')
    .optional()
    .nullable(),
  subjectId: cuid.optional().nullable(),
  assignmentId: cuid.optional().nullable(),
  recurrence: z.enum(RECURRENCE).optional().nullable(),
  recurrenceUntil: isoDate.optional().nullable(),
  /** Opt in to double-booking rather than being blocked by a conflict. */
  allowOverlap: z.boolean().optional(),
});

export const updateBlockSchema = createBlockSchema
  .partial()
  .extend({ locked: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const listBlocksSchema = z.object({
  from: isoDate,
  to: isoDate,
  subjectId: cuid.optional(),
  type: z
    .union([z.string(), z.array(z.enum(BLOCK_TYPE))])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const list = Array.isArray(value) ? value : value.split(',');
      return list.map((entry) => entry.trim()).filter(Boolean);
    })
    .pipe(z.array(z.enum(BLOCK_TYPE)).optional()),
});

export const weekQuerySchema = z.object({
  weekStart: isoDate.optional(),
});

export const deleteBlockSchema = z.object({
  scope: z.enum(['one', 'following', 'all']).default('one'),
});

export const blockIdSchema = z.object({ id: cuid });

// --- Planner ----------------------------------------------------------------

export const generatePlanSchema = z.object({
  from: isoDate.optional(),
  days: z.coerce.number().int().min(1).max(28).default(7),
  dayStartHour: z.coerce.number().int().min(0).max(23).default(9),
  dayEndHour: z.coerce.number().int().min(1).max(24).default(21),
  maxSessionMinutes: z.coerce.number().int().min(15).max(240).default(50),
  minSessionMinutes: z.coerce.number().int().min(5).max(120).default(25),
  includeAdvice: z.boolean().default(true),
}).refine(
  (value) => value.dayEndHour > value.dayStartHour,
  'The day must end after it starts',
).refine(
  (value) => value.maxSessionMinutes >= value.minSessionMinutes,
  'Maximum session length must be at least the minimum',
);

export const applyPlanSchema = z.object({
  sessions: z
    .array(
      z.object({
        taskId: cuid,
        title: z.string().trim().min(1).max(200),
        startAt: isoDate,
        endAt: isoDate,
        subjectId: cuid.optional().nullable(),
      }),
    )
    .min(1, 'Provide at least one session')
    .max(200),
  /** Remove previously AI-generated blocks in the range before applying. */
  replaceExisting: z.boolean().default(false),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

// --- Focus ------------------------------------------------------------------

export const startSessionSchema = z.object({
  type: z.enum(SESSION_TYPE).default('POMODORO'),
  subjectId: cuid.optional().nullable(),
  assignmentId: cuid.optional().nullable(),
  ambientSound: z.string().trim().max(40).optional().nullable(),
});

export const endSessionSchema = z.object({
  completed: z.boolean().default(true),
  interruptions: z.coerce.number().int().min(0).max(200).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const listSessionsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const sessionIdSchema = z.object({ id: cuid });

// --- Analytics --------------------------------------------------------------

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
});

export type CreateBlockInput = z.infer<typeof createBlockSchema>;
export type UpdateBlockInput = z.infer<typeof updateBlockSchema>;
export type ListBlocksQuery = z.infer<typeof listBlocksSchema>;
export type GeneratePlanInput = z.infer<typeof generatePlanSchema>;
export type ApplyPlanInput = z.infer<typeof applyPlanSchema>;
export type StartSessionInput = z.infer<typeof startSessionSchema>;
export type EndSessionInput = z.infer<typeof endSessionSchema>;
