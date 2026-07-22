import { z } from 'zod';

const ASSIGNMENT_STATUS = [
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'SUBMITTED',
  'COMPLETED',
  'ARCHIVED',
] as const;

const PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const RECURRENCE = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;

export const SORTABLE_FIELDS = [
  'dueAt',
  'createdAt',
  'updatedAt',
  'priority',
  'title',
  'status',
] as const;

const cuid = z.string().min(1);
const isoDate = z.coerce.date();

export const createAssignmentSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(10_000).optional(),
  subjectId: cuid.optional().nullable(),
  status: z.enum(ASSIGNMENT_STATUS).default('TODO'),
  priority: z.enum(PRIORITY).default('MEDIUM'),
  dueAt: isoDate.optional().nullable(),
  startAt: isoDate.optional().nullable(),
  estimatedMinutes: z.number().int().min(0).max(100_000).optional().nullable(),
  maxGrade: z.number().min(0).optional().nullable(),
  weight: z.number().min(0).max(100).optional().nullable(),
  labels: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  recurrence: z.enum(RECURRENCE).optional().nullable(),
  recurrenceInterval: z.number().int().min(1).max(52).optional().nullable(),
  recurrenceUntil: isoDate.optional().nullable(),
  reminderAt: isoDate.optional().nullable(),
});

/**
 * Every field optional — PATCH semantics. `.partial()` on the create schema
 * would also drop its defaults, which is what we want here: an omitted field
 * must mean "leave unchanged", not "reset to default".
 */
export const updateAssignmentSchema = createAssignmentSchema
  .partial()
  .extend({
    progress: z.number().int().min(0).max(100).optional(),
    actualMinutes: z.number().int().min(0).optional(),
    grade: z.number().min(0).optional().nullable(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide at least one field to update',
  );

/**
 * Comma-separated repeated values (`?status=TODO,IN_PROGRESS`) are normalised
 * to arrays so the frontend can build filter queries naturally.
 */
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.enum(values))])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const list = Array.isArray(value) ? value : value.split(',');
      return list.map((entry) => entry.trim()).filter(Boolean);
    })
    .pipe(z.array(z.enum(values)).optional());

export const listAssignmentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(SORTABLE_FIELDS).default('dueAt'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),

  status: csvEnum(ASSIGNMENT_STATUS),
  priority: csvEnum(PRIORITY),
  subjectId: cuid.optional(),
  labels: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const list = Array.isArray(value) ? value : value.split(',');
      return list.map((entry) => entry.trim()).filter(Boolean);
    }),

  search: z.string().trim().max(200).optional(),
  dueBefore: isoDate.optional(),
  dueAfter: isoDate.optional(),

  /** Convenience filters the dashboard uses directly. */
  overdue: z.coerce.boolean().optional(),
  includeCompleted: z.coerce.boolean().default(true),
  includeArchived: z.coerce.boolean().default(false),
});

export const assignmentIdSchema = z.object({ id: cuid });

export const bulkUpdateSchema = z.object({
  ids: z.array(cuid).min(1, 'Select at least one assignment').max(100),
  status: z.enum(ASSIGNMENT_STATUS).optional(),
  priority: z.enum(PRIORITY).optional(),
  subjectId: cuid.nullable().optional(),
});

export const createSubjectSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  code: z.string().trim().max(20).optional().nullable(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a hex value like #8b5cf6')
    .default('#8b5cf6'),
  icon: z.string().trim().max(40).optional().nullable(),
  teacherName: z.string().trim().max(80).optional().nullable(),
  room: z.string().trim().max(40).optional().nullable(),
  credits: z.number().min(0).max(100).optional().nullable(),
  targetGrade: z.number().min(0).max(100).optional().nullable(),
});

export const updateSubjectSchema = createSubjectSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const subjectIdSchema = z.object({ id: cuid });

export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;
export type ListAssignmentsQuery = z.infer<typeof listAssignmentsSchema>;
export type BulkUpdateInput = z.infer<typeof bulkUpdateSchema>;
export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;
export type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>;
