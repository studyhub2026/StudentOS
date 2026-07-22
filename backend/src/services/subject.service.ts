import { AssignmentStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';
import type {
  CreateSubjectInput,
  UpdateSubjectInput,
} from '../validators/assignment.validator.js';

export interface SubjectWithCounts {
  id: string;
  name: string;
  code: string | null;
  color: string;
  icon: string | null;
  teacherName: string | null;
  room: string | null;
  credits: number | null;
  targetGrade: number | null;
  archived: boolean;
  createdAt: Date;
  assignmentCount: number;
  openAssignmentCount: number;
}

export async function listSubjects(
  userId: string,
  includeArchived = false,
): Promise<SubjectWithCounts[]> {
  const subjects = await prisma.subject.findMany({
    where: { userId, ...(includeArchived ? {} : { archived: false }) },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { assignments: { where: { deletedAt: null } } } },
    },
  });

  // A second grouped query is cheaper than a correlated count per subject.
  const openCounts = await prisma.assignment.groupBy({
    by: ['subjectId'],
    where: {
      userId,
      deletedAt: null,
      status: {
        notIn: [
          AssignmentStatus.COMPLETED,
          AssignmentStatus.SUBMITTED,
          AssignmentStatus.ARCHIVED,
        ],
      },
    },
    _count: { _all: true },
  });

  const openBySubject = new Map(
    openCounts.map((row) => [row.subjectId, row._count._all] as const),
  );

  return subjects.map(({ _count, userId: _userId, updatedAt: _updatedAt, ...subject }) => ({
    ...subject,
    assignmentCount: _count.assignments,
    openAssignmentCount: openBySubject.get(subject.id) ?? 0,
  }));
}

export async function createSubject(userId: string, input: CreateSubjectInput) {
  try {
    return await prisma.subject.create({
      data: {
        userId,
        name: input.name,
        code: input.code ?? null,
        color: input.color,
        icon: input.icon ?? null,
        teacherName: input.teacherName ?? null,
        room: input.room ?? null,
        credits: input.credits ?? null,
        targetGrade: input.targetGrade ?? null,
      },
    });
  } catch (error) {
    // Unique on (userId, name) — surface a usable message rather than a 500.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictError('You already have a subject with that name');
    }
    throw error;
  }
}

export async function updateSubject(userId: string, id: string, input: UpdateSubjectInput) {
  const existing = await prisma.subject.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('Subject');

  const data: Prisma.SubjectUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.code !== undefined) data.code = input.code;
  if (input.color !== undefined) data.color = input.color;
  if (input.icon !== undefined) data.icon = input.icon;
  if (input.teacherName !== undefined) data.teacherName = input.teacherName;
  if (input.room !== undefined) data.room = input.room;
  if (input.credits !== undefined) data.credits = input.credits;
  if (input.targetGrade !== undefined) data.targetGrade = input.targetGrade;
  if (input.archived !== undefined) data.archived = input.archived;

  try {
    return await prisma.subject.update({ where: { id }, data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictError('You already have a subject with that name');
    }
    throw error;
  }
}

/**
 * Hard delete. The schema sets `onDelete: SetNull` for assignments, so their
 * history survives with the subject link cleared rather than cascading away.
 */
export async function deleteSubject(userId: string, id: string): Promise<void> {
  const result = await prisma.subject.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new NotFoundError('Subject');
}

export const subjectService = {
  listSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
} as const;
