import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { BadRequestError, NotFoundError } from '@/server/lib/errors';
import { applyConflictResolution } from './university-sync.service';

/**
 * Conflict Resolution Center service.
 *
 * A conflict is created by the sync engine when the locally-mirrored copy of
 * a synced record has been edited AND the remote copy has changed since the
 * last successful sync. The user reviews via /university/conflicts and picks
 * one of four actions:
 *
 *   KEEP_LOCAL   — remote data is discarded; local wins.
 *   KEEP_REMOTE  — local mirror is overwritten with the remote value.
 *   MERGE        — user picks per-field which side wins; final blob is applied.
 *   IGNORE       — mark as resolved without applying anything.
 *
 * Every action is written to LmsConflictResolution so the full history is
 * visible AND the last action can be undone (which re-opens the conflict).
 * The mutation of the actual entity lives in `university-sync.service`'s
 * `applyConflictResolution` — there's no per-entity code in this file, so
 * new entity kinds only need to touch the sync service.
 */

export type ResolutionAction = 'KEEP_LOCAL' | 'KEEP_REMOTE' | 'MERGE' | 'IGNORE';

const RESOLUTION_ACTIONS: ResolutionAction[] = ['KEEP_LOCAL', 'KEEP_REMOTE', 'MERGE', 'IGNORE'];

export function isResolutionAction(x: unknown): x is ResolutionAction {
  return typeof x === 'string' && RESOLUTION_ACTIONS.includes(x as ResolutionAction);
}

const conflictInclude = {
  connection: { select: { id: true, displayName: true, provider: true } },
  resolutions: {
    orderBy: { createdAt: 'desc' as const },
    take: 20,
  },
} satisfies Prisma.LmsConflictInclude;

export type ConflictWithHistory = Prisma.LmsConflictGetPayload<{
  include: typeof conflictInclude;
}>;

export async function listConflicts(
  userId: string,
  status: 'PENDING' | 'RESOLVED' | 'IGNORED' | 'ALL' = 'PENDING',
): Promise<ConflictWithHistory[]> {
  const where: Prisma.LmsConflictWhereInput = { userId };
  if (status !== 'ALL') where.status = status;
  return prisma.lmsConflict.findMany({
    where,
    include: conflictInclude,
    orderBy: { detectedAt: 'desc' },
    take: 100,
  });
}

export async function getConflict(userId: string, id: string): Promise<ConflictWithHistory> {
  const conflict = await prisma.lmsConflict.findUnique({
    where: { id },
    include: conflictInclude,
  });
  if (!conflict || conflict.userId !== userId) throw new NotFoundError('Conflict');
  return conflict;
}

export async function resolveConflict(
  userId: string,
  id: string,
  action: ResolutionAction,
  mergedData?: Record<string, unknown>,
): Promise<ConflictWithHistory> {
  const conflict = await prisma.lmsConflict.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true },
  });
  if (!conflict || conflict.userId !== userId) throw new NotFoundError('Conflict');
  if (conflict.status !== 'PENDING') {
    throw new BadRequestError(
      `Conflict is already ${conflict.status.toLowerCase()} — undo before resolving again`,
    );
  }
  if (action === 'MERGE' && !mergedData) {
    throw new BadRequestError('MERGE requires mergedData');
  }

  await applyConflictResolution(id, action, mergedData);

  const nextStatus = action === 'IGNORE' ? 'IGNORED' : 'RESOLVED';
  await prisma.$transaction([
    prisma.lmsConflict.update({
      where: { id },
      data: { status: nextStatus, resolvedAt: new Date() },
    }),
    prisma.lmsConflictResolution.create({
      data: {
        conflictId: id,
        userId,
        action,
        data:
          action === 'MERGE'
            ? (mergedData as unknown as Prisma.InputJsonValue)
            : undefined,
      },
    }),
  ]);

  return getConflict(userId, id);
}

/**
 * Reverts the most recent non-UNDONE resolution. The conflict goes back to
 * PENDING; the reverse action is recorded as an UNDONE row so the audit trail
 * shows both the forward and reverse steps.
 *
 * Note: undo only restores the conflict's `status`. It doesn't rewind the
 * mirrored entity's fields — that would require capturing pre-resolution
 * snapshots, which we do store on the LmsConflictResolution row for the MERGE
 * case. Users who want to change their mind should resolve again with a
 * different action; the newer resolution wins.
 */
export async function undoLastResolution(
  userId: string,
  id: string,
): Promise<ConflictWithHistory> {
  const conflict = await prisma.lmsConflict.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true, resolutions: { orderBy: { createdAt: 'desc' }, take: 5 } },
  });
  if (!conflict || conflict.userId !== userId) throw new NotFoundError('Conflict');
  const latest = conflict.resolutions.find((r) => r.action !== 'UNDONE');
  if (!latest) throw new BadRequestError('No resolution to undo');
  if (conflict.status === 'PENDING') throw new BadRequestError('Conflict is already pending');

  await prisma.$transaction([
    prisma.lmsConflict.update({
      where: { id },
      data: { status: 'PENDING', resolvedAt: null },
    }),
    prisma.lmsConflictResolution.create({
      data: {
        conflictId: id,
        userId,
        action: 'UNDONE',
        data: { undoneResolutionId: latest.id, previousAction: latest.action },
      },
    }),
  ]);

  return getConflict(userId, id);
}

export const conflictService = {
  listConflicts,
  getConflict,
  resolveConflict,
  undoLastResolution,
  isResolutionAction,
};
