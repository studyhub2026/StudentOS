import 'server-only';
import { Prisma, type ScheduleBlockType } from '@prisma/client';
import { prisma } from '@/server/db';
import { BadRequestError, ConflictError, NotFoundError } from '@/server/lib/errors';
import { expandRecurrence, findConflicts, overlaps } from '@/server/services/scheduling';
import type {
  CreateBlockInput,
  ListBlocksQuery,
  UpdateBlockInput,
} from '@/server/validators/schedule.validator';

const blockInclude = {
  subject: { select: { id: true, name: true, color: true } },
  assignment: { select: { id: true, title: true, status: true } },
} satisfies Prisma.ScheduleBlockInclude;

export type BlockWithRelations = Prisma.ScheduleBlockGetPayload<{
  include: typeof blockInclude;
}>;

export async function listBlocks(
  userId: string,
  query: ListBlocksQuery,
): Promise<BlockWithRelations[]> {
  const where: Prisma.ScheduleBlockWhereInput = {
    userId,
    startAt: { gte: query.from, lt: query.to },
  };

  if (query.subjectId) where.subjectId = query.subjectId;
  if (query.type?.length) where.type = { in: query.type as ScheduleBlockType[] };

  return prisma.scheduleBlock.findMany({
    where,
    include: blockInclude,
    orderBy: { startAt: 'asc' },
  });
}

/**
 * Blocks in the same window that a candidate could collide with. Excludes the
 * block being edited so moving it a few minutes is not a self-conflict.
 */
async function loadNeighbours(
  userId: string,
  startAt: Date,
  endAt: Date,
  excludeId?: string,
) {
  return prisma.scheduleBlock.findMany({
    where: {
      userId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      // Any block that starts before this one ends and ends after it starts.
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true, title: true, startAt: true, endAt: true },
  });
}

export async function findBlockConflicts(
  userId: string,
  startAt: Date,
  endAt: Date,
  excludeId?: string,
) {
  const neighbours = await loadNeighbours(userId, startAt, endAt, excludeId);
  return findConflicts({ startAt, endAt }, neighbours);
}

async function assertOwnedRelations(userId: string, input: Partial<CreateBlockInput>) {
  if (input.subjectId) {
    const subject = await prisma.subject.findFirst({
      where: { id: input.subjectId, userId },
      select: { id: true },
    });
    if (!subject) throw new BadRequestError('That subject does not exist');
  }
  if (input.assignmentId) {
    const assignment = await prisma.assignment.findFirst({
      where: { id: input.assignmentId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!assignment) throw new BadRequestError('That assignment does not exist');
  }
}

export async function createBlock(
  userId: string,
  input: CreateBlockInput,
): Promise<BlockWithRelations> {
  if (input.endAt <= input.startAt) {
    throw new BadRequestError('A block must end after it starts');
  }

  await assertOwnedRelations(userId, input);

  if (!input.allowOverlap) {
    const conflicts = await findBlockConflicts(userId, input.startAt, input.endAt);
    if (conflicts.length > 0) {
      throw new ConflictError(
        `This overlaps "${conflicts[0]?.title}". Move it, or set allowOverlap to schedule anyway.`,
      );
    }
  }

  const block = await prisma.scheduleBlock.create({
    data: {
      userId,
      title: input.title,
      type: input.type,
      startAt: input.startAt,
      endAt: input.endAt,
      location: input.location ?? null,
      notes: input.notes ?? null,
      color: input.color ?? null,
      subjectId: input.subjectId ?? null,
      assignmentId: input.assignmentId ?? null,
      recurrence: input.recurrence ?? null,
      recurrenceUntil: input.recurrenceUntil ?? null,
    },
    include: blockInclude,
  });

  // Materialise recurring occurrences as real rows so they can be edited,
  // moved and completed individually.
  if (input.recurrence && input.recurrenceUntil) {
    const occurrences = expandRecurrence(
      { startAt: input.startAt, endAt: input.endAt },
      input.recurrence,
      // Inclusive of the final day, matching how people read "repeat until".
      endOfDay(input.recurrenceUntil),
    ).slice(1); // the first occurrence is the block itself

    if (occurrences.length > 0) {
      await prisma.scheduleBlock.createMany({
        data: occurrences.map((occurrence) => ({
          userId,
          parentBlockId: block.id,
          title: input.title,
          type: input.type,
          startAt: occurrence.startAt,
          endAt: occurrence.endAt,
          location: input.location ?? null,
          notes: input.notes ?? null,
          color: input.color ?? null,
          subjectId: input.subjectId ?? null,
          assignmentId: input.assignmentId ?? null,
        })),
      });
    }
  }

  return block;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export async function updateBlock(
  userId: string,
  id: string,
  input: UpdateBlockInput,
): Promise<BlockWithRelations> {
  const existing = await prisma.scheduleBlock.findFirst({
    where: { id, userId },
    select: { id: true, startAt: true, endAt: true, locked: true },
  });
  if (!existing) throw new NotFoundError('Schedule block');
  if (existing.locked && (input.startAt || input.endAt)) {
    throw new BadRequestError('This block is locked and cannot be moved');
  }

  await assertOwnedRelations(userId, input);

  const startAt = input.startAt ?? existing.startAt;
  const endAt = input.endAt ?? existing.endAt;

  if (endAt <= startAt) throw new BadRequestError('A block must end after it starts');

  if ((input.startAt || input.endAt) && !input.allowOverlap) {
    const conflicts = await findBlockConflicts(userId, startAt, endAt, id);
    if (conflicts.length > 0) {
      throw new ConflictError(`This overlaps "${conflicts[0]?.title}".`);
    }
  }

  const data: Prisma.ScheduleBlockUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.type !== undefined) data.type = input.type;
  if (input.startAt !== undefined) data.startAt = input.startAt;
  if (input.endAt !== undefined) data.endAt = input.endAt;
  if (input.location !== undefined) data.location = input.location;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.color !== undefined) data.color = input.color;
  if (input.locked !== undefined) data.locked = input.locked;
  if (input.subjectId !== undefined) {
    data.subject = input.subjectId ? { connect: { id: input.subjectId } } : { disconnect: true };
  }
  if (input.assignmentId !== undefined) {
    data.assignment = input.assignmentId
      ? { connect: { id: input.assignmentId } }
      : { disconnect: true };
  }

  return prisma.scheduleBlock.update({ where: { id }, data, include: blockInclude });
}

export async function deleteBlock(
  userId: string,
  id: string,
  scope: 'one' | 'following' | 'all' = 'one',
): Promise<number> {
  const block = await prisma.scheduleBlock.findFirst({
    where: { id, userId },
    select: { id: true, parentBlockId: true, startAt: true },
  });
  if (!block) throw new NotFoundError('Schedule block');

  if (scope === 'one') {
    await prisma.scheduleBlock.delete({ where: { id } });
    return 1;
  }

  // A child's series root is its parent; a parent is its own root.
  const rootId = block.parentBlockId ?? block.id;

  const where: Prisma.ScheduleBlockWhereInput = {
    userId,
    OR: [{ id: rootId }, { parentBlockId: rootId }],
    ...(scope === 'following' ? { startAt: { gte: block.startAt } } : {}),
  };

  const result = await prisma.scheduleBlock.deleteMany({ where });
  return result.count;
}

/** Groups a week's blocks by local date for the timetable grid. */
export async function getWeek(userId: string, weekStart: Date) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const blocks = await listBlocks(userId, {
    from: weekStart,
    to: weekEnd,
  } as ListBlocksQuery);

  const days = new Map<string, BlockWithRelations[]>();
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + offset);
    days.set(toDateKey(day), []);
  }

  for (const block of blocks) {
    const key = toDateKey(block.startAt);
    days.get(key)?.push(block);
  }

  return {
    weekStart: weekStart.toISOString(),
    days: [...days.entries()].map(([date, items]) => ({ date, blocks: items })),
    totalBlocks: blocks.length,
  };
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const scheduleService = {
  listBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
  getWeek,
  findBlockConflicts,
  overlaps,
} as const;
