import 'server-only';
import { AssignmentStatus, Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { BadRequestError, NotFoundError } from '@/server/lib/errors';
import type {
  BulkUpdateInput,
  CreateAssignmentInput,
  ListAssignmentsQuery,
  UpdateAssignmentInput,
} from '@/server/validators/assignment.validator';

/**
 * Assignment reads always include the subject, since every list and detail
 * view in the UI renders its name and colour.
 */
const assignmentInclude = {
  subject: { select: { id: true, name: true, color: true, code: true } },
  attachments: {
    select: { id: true, filename: true, mimeType: true, sizeBytes: true, url: true },
  },
  _count: { select: { occurrences: true } },
} satisfies Prisma.AssignmentInclude;

export type AssignmentWithRelations = Prisma.AssignmentGetPayload<{
  include: typeof assignmentInclude;
}>;

export interface PaginatedAssignments {
  items: AssignmentWithRelations[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

const TERMINAL_STATUSES: AssignmentStatus[] = [
  AssignmentStatus.COMPLETED,
  AssignmentStatus.SUBMITTED,
];

/** Builds the Prisma filter for a list query. Always scoped to one user. */
function buildWhere(userId: string, query: ListAssignmentsQuery): Prisma.AssignmentWhereInput {
  const where: Prisma.AssignmentWhereInput = {
    userId,
    deletedAt: null,
  };

  const excluded: AssignmentStatus[] = [];
  if (!query.includeCompleted) excluded.push(AssignmentStatus.COMPLETED);
  if (!query.includeArchived) excluded.push(AssignmentStatus.ARCHIVED);

  if (query.status?.length) {
    where.status = { in: query.status as AssignmentStatus[] };
  } else if (excluded.length) {
    where.status = { notIn: excluded };
  }

  if (query.priority?.length) {
    where.priority = { in: query.priority as Prisma.EnumPriorityFilter['in'] };
  }
  if (query.subjectId) where.subjectId = query.subjectId;
  if (query.labels?.length) where.labels = { hasSome: query.labels };

  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { description: { contains: query.search, mode: 'insensitive' } },
      { labels: { has: query.search } },
    ];
  }

  if (query.overdue) {
    // Overdue means past due and not yet finished — a completed assignment
    // with a past due date is not overdue.
    where.dueAt = { lt: new Date() };
    where.status = { notIn: [...TERMINAL_STATUSES, AssignmentStatus.ARCHIVED] };
  } else if (query.dueBefore || query.dueAfter) {
    where.dueAt = {
      ...(query.dueAfter ? { gte: query.dueAfter } : {}),
      ...(query.dueBefore ? { lte: query.dueBefore } : {}),
    };
  }

  return where;
}

function buildOrderBy(
  query: ListAssignmentsQuery,
): Prisma.AssignmentOrderByWithRelationInput[] {
  // Nulls last on due date: undated work should not crowd out what is due
  // soon. A stable secondary key keeps pagination deterministic.
  if (query.sortBy === 'dueAt') {
    return [{ dueAt: { sort: query.sortOrder, nulls: 'last' } }, { createdAt: 'desc' }];
  }
  return [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }];
}

export async function listAssignments(
  userId: string,
  query: ListAssignmentsQuery,
): Promise<PaginatedAssignments> {
  const where = buildWhere(userId, query);
  const skip = (query.page - 1) * query.limit;

  const [items, total] = await Promise.all([
    prisma.assignment.findMany({
      where,
      include: assignmentInclude,
      orderBy: buildOrderBy(query),
      skip,
      take: query.limit,
    }),
    prisma.assignment.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / query.limit));

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNext: query.page < totalPages,
      hasPrevious: query.page > 1,
    },
  };
}

export async function getAssignment(
  userId: string,
  id: string,
): Promise<AssignmentWithRelations> {
  const assignment = await prisma.assignment.findFirst({
    where: { id, userId, deletedAt: null },
    include: assignmentInclude,
  });

  if (!assignment) throw new NotFoundError('Assignment');
  return assignment;
}

/** Confirms a subject belongs to the user before linking it. */
async function assertSubjectOwned(userId: string, subjectId: string): Promise<void> {
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, userId },
    select: { id: true },
  });
  if (!subject) throw new BadRequestError('That subject does not exist');
}

export async function createAssignment(
  userId: string,
  input: CreateAssignmentInput,
): Promise<AssignmentWithRelations> {
  if (input.subjectId) await assertSubjectOwned(userId, input.subjectId);

  if (input.recurrence && !input.recurrenceUntil) {
    throw new BadRequestError('A recurring assignment needs an end date');
  }
  if (input.startAt && input.dueAt && input.startAt > input.dueAt) {
    throw new BadRequestError('Start date must be before the due date');
  }

  return prisma.assignment.create({
    data: {
      userId,
      title: input.title,
      description: input.description ?? null,
      subjectId: input.subjectId ?? null,
      status: input.status,
      priority: input.priority,
      dueAt: input.dueAt ?? null,
      startAt: input.startAt ?? null,
      estimatedMinutes: input.estimatedMinutes ?? null,
      maxGrade: input.maxGrade ?? null,
      weight: input.weight ?? null,
      labels: input.labels,
      recurrence: input.recurrence ?? null,
      recurrenceInterval: input.recurrenceInterval ?? null,
      recurrenceUntil: input.recurrenceUntil ?? null,
      reminderAt: input.reminderAt ?? null,
      ...(input.status === AssignmentStatus.COMPLETED ? { completedAt: new Date() } : {}),
    },
    include: assignmentInclude,
  });
}

export async function updateAssignment(
  userId: string,
  id: string,
  input: UpdateAssignmentInput,
): Promise<AssignmentWithRelations> {
  const existing = await prisma.assignment.findFirst({
    where: { id, userId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!existing) throw new NotFoundError('Assignment');

  if (input.subjectId) await assertSubjectOwned(userId, input.subjectId);

  const data: Prisma.AssignmentUpdateInput = {};

  // Only assign fields actually present, so PATCH cannot null out omitted
  // values. `undefined` is meaningful here and must not be written.
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.status !== undefined) data.status = input.status;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.dueAt !== undefined) data.dueAt = input.dueAt;
  if (input.startAt !== undefined) data.startAt = input.startAt;
  if (input.estimatedMinutes !== undefined) data.estimatedMinutes = input.estimatedMinutes;
  if (input.actualMinutes !== undefined) data.actualMinutes = input.actualMinutes;
  if (input.progress !== undefined) data.progress = input.progress;
  if (input.grade !== undefined) data.grade = input.grade;
  if (input.maxGrade !== undefined) data.maxGrade = input.maxGrade;
  if (input.weight !== undefined) data.weight = input.weight;
  if (input.labels !== undefined) data.labels = input.labels;
  if (input.reminderAt !== undefined) {
    data.reminderAt = input.reminderAt;
    // A rescheduled reminder must fire again.
    data.reminderSent = false;
  }

  if (input.subjectId !== undefined) {
    data.subject = input.subjectId
      ? { connect: { id: input.subjectId } }
      : { disconnect: true };
  }

  // Keep completedAt consistent with status transitions in both directions.
  let justCompleted = false;
  if (input.status !== undefined && input.status !== existing.status) {
    if (TERMINAL_STATUSES.includes(input.status)) {
      data.completedAt = new Date();
      if (input.progress === undefined) data.progress = 100;
      justCompleted = true;
    } else if (TERMINAL_STATUSES.includes(existing.status)) {
      data.completedAt = null;
    }
  }

  const updated = await prisma.assignment.update({ where: { id }, data, include: assignmentInclude });

  if (justCompleted) {
    // Fire-and-forget gamification: completing an assignment advances daily
    // missions and weekly challenges and grants XP. Never block the response.
    void (async () => {
      try {
        const { awardXp, updateMissionProgress, updateChallengeProgress } = await import(
          './gamification.service'
        );
        await awardXp(userId, 40);
        await updateMissionProgress(userId, 'complete_1', 1);
        await updateChallengeProgress(userId, 'complete_5', 1);
      } catch {
        // gamification is best-effort
      }
    })();
  }

  return updated;
}

/**
 * Soft delete — the row is retained so analytics history stays intact and an
 * accidental deletion can be undone.
 */
export async function deleteAssignment(userId: string, id: string): Promise<void> {
  const result = await prisma.assignment.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new NotFoundError('Assignment');
}

export async function restoreAssignment(
  userId: string,
  id: string,
): Promise<AssignmentWithRelations> {
  const result = await prisma.assignment.updateMany({
    where: { id, userId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
  if (result.count === 0) throw new NotFoundError('Assignment');
  return getAssignment(userId, id);
}

export async function bulkUpdate(userId: string, input: BulkUpdateInput): Promise<number> {
  // The "unchecked" variant is the one that accepts relation scalars such as
  // subjectId directly, which updateMany requires.
  const data: Prisma.AssignmentUncheckedUpdateManyInput = {};

  if (input.status !== undefined) {
    data.status = input.status;
    if (TERMINAL_STATUSES.includes(input.status)) {
      data.completedAt = new Date();
      data.progress = 100;
    } else {
      data.completedAt = null;
    }
  }
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.subjectId !== undefined) data.subjectId = input.subjectId;

  if (Object.keys(data).length === 0) {
    throw new BadRequestError('Provide at least one field to update');
  }

  // The userId predicate is what prevents editing another account's rows.
  const result = await prisma.assignment.updateMany({
    where: { id: { in: input.ids }, userId, deletedAt: null },
    data,
  });

  return result.count;
}

export interface AssignmentStats {
  total: number;
  completed: number;
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  completionRate: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
}

export async function getStats(userId: string): Promise<AssignmentStats> {
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const endOfWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const active = { userId, deletedAt: null };
  const unfinished = {
    ...active,
    status: { notIn: [...TERMINAL_STATUSES, AssignmentStatus.ARCHIVED] },
  };

  const [total, completed, overdue, dueToday, dueThisWeek, byStatus, byPriority] =
    await Promise.all([
      prisma.assignment.count({ where: active }),
      prisma.assignment.count({
        where: { ...active, status: { in: TERMINAL_STATUSES } },
      }),
      prisma.assignment.count({ where: { ...unfinished, dueAt: { lt: now } } }),
      prisma.assignment.count({
        where: { ...unfinished, dueAt: { gte: now, lte: endOfToday } },
      }),
      prisma.assignment.count({
        where: { ...unfinished, dueAt: { gte: now, lte: endOfWeek } },
      }),
      prisma.assignment.groupBy({ by: ['status'], where: active, _count: { _all: true } }),
      prisma.assignment.groupBy({ by: ['priority'], where: active, _count: { _all: true } }),
    ]);

  return {
    total,
    completed,
    overdue,
    dueToday,
    dueThisWeek,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
    byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    byPriority: Object.fromEntries(byPriority.map((row) => [row.priority, row._count._all])),
  };
}

/** Distinct labels across a user's assignments, for filter autocomplete. */
export async function listLabels(userId: string): Promise<string[]> {
  const rows = await prisma.assignment.findMany({
    where: { userId, deletedAt: null },
    select: { labels: true },
  });

  return [...new Set(rows.flatMap((row) => row.labels))].sort((a, b) => a.localeCompare(b));
}

export const assignmentService = {
  listAssignments,
  getAssignment,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  restoreAssignment,
  bulkUpdate,
  getStats,
  listLabels,
} as const;
