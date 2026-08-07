import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { BadRequestError, NotFoundError } from '@/server/lib/errors';
import { env } from '@/server/env';
import { runSyncJob } from './university-sync.service';
import { enqueueManualSync } from '@/server/queue/lms-sync.queue';

const PREVIEW_TTL_MINUTES = 15;

/**
 * Sync Preview / dry-run service.
 *
 * The user requests a preview from the UI; we invoke runSyncJob in `dryRun`
 * mode, which walks the remote data with the real adapter but never mutates
 * the DB. The resulting plan + cost estimates are stored on LmsSyncPreview
 * with a TTL. The user reviews and either approves (which enqueues a real
 * sync via the shared BullMQ queue) or cancels.
 *
 * Reuses:
 *   - runSyncJob (same code path as real syncs; nothing duplicated)
 *   - BullMQ queue (approve → enqueueManualSync)
 *   - SyncLog (the dry-run itself is recorded there with dryRun=true)
 */

export async function createPreview(userId: string, connectionId: string) {
  const conn = await prisma.lmsConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, userId: true, status: true },
  });
  if (!conn || conn.userId !== userId) throw new NotFoundError('Connection');
  if (conn.status === 'SYNCING') {
    throw new BadRequestError('Cannot preview while a sync is in progress');
  }

  // Cancel any older pending previews for this connection so the UI never
  // shows two competing plans.
  await prisma.lmsSyncPreview.updateMany({
    where: { connectionId, status: 'PENDING' },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });

  let result;
  try {
    result = await runSyncJob(userId, connectionId, {
      scheduled: false,
      attempt: 1,
      dryRun: true,
    });
  } catch (err) {
    // Dry-run failures (bad credentials, unreachable portal, missing capabilities)
    // are user-actionable configuration issues, not server bugs. Surface them as
    // BadRequestError so the UI shows the real reason.
    const msg = err instanceof Error ? err.message : String(err);
    throw new BadRequestError(`Preview failed: ${msg}`);
  }

  const preview = await prisma.lmsSyncPreview.create({
    data: {
      connectionId,
      userId,
      plan: (result.plan ?? {}) as unknown as Prisma.InputJsonValue,
      estimates: (result.estimates ?? {}) as unknown as Prisma.InputJsonValue,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MINUTES * 60_000),
    },
    include: { connection: { select: { displayName: true, provider: true } } },
  });

  return preview;
}

export async function getPreview(userId: string, previewId: string) {
  const preview = await prisma.lmsSyncPreview.findUnique({
    where: { id: previewId },
    include: { connection: { select: { displayName: true, provider: true, portalUrl: true } } },
  });
  if (!preview || preview.userId !== userId) throw new NotFoundError('Preview');
  return preview;
}

export async function listPendingPreviews(userId: string) {
  // Auto-expire before listing so stale previews disappear from the UI.
  await prisma.lmsSyncPreview.updateMany({
    where: {
      userId,
      status: 'PENDING',
      expiresAt: { lt: new Date() },
    },
    data: { status: 'EXPIRED' },
  });
  return prisma.lmsSyncPreview.findMany({
    where: { userId, status: 'PENDING' },
    include: { connection: { select: { displayName: true, provider: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function approvePreview(userId: string, previewId: string) {
  const preview = await prisma.lmsSyncPreview.findUnique({
    where: { id: previewId },
    select: { id: true, userId: true, connectionId: true, status: true, expiresAt: true },
  });
  if (!preview || preview.userId !== userId) throw new NotFoundError('Preview');
  if (preview.status !== 'PENDING') {
    throw new BadRequestError(`Preview is ${preview.status.toLowerCase()} and cannot be approved`);
  }
  if (preview.expiresAt < new Date()) {
    await prisma.lmsSyncPreview.update({
      where: { id: previewId },
      data: { status: 'EXPIRED' },
    });
    throw new BadRequestError('Preview expired — request a new one');
  }

  await prisma.lmsSyncPreview.update({
    where: { id: previewId },
    data: { status: 'APPROVED', approvedAt: new Date() },
  });

  // Enqueue the real sync through the shared BullMQ queue, or fall back to
  // inline when Redis isn't configured — same fallback used everywhere.
  if (env.hasRedis) {
    const jobId = await enqueueManualSync(preview.connectionId, userId);
    return { jobId, syncLogId: undefined as string | undefined };
  }
  const result = await runSyncJob(userId, preview.connectionId, {
    scheduled: false,
    attempt: 1,
  });
  return { jobId: undefined as string | undefined, syncLogId: result.syncLogId };
}

export async function cancelPreview(userId: string, previewId: string): Promise<void> {
  const preview = await prisma.lmsSyncPreview.findUnique({
    where: { id: previewId },
    select: { id: true, userId: true, status: true },
  });
  if (!preview || preview.userId !== userId) throw new NotFoundError('Preview');
  if (preview.status !== 'PENDING') return;
  await prisma.lmsSyncPreview.update({
    where: { id: previewId },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });
}

export const previewService = {
  createPreview,
  getPreview,
  listPendingPreviews,
  approvePreview,
  cancelPreview,
};
