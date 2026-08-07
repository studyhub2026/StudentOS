import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { env } from '@/server/env';
import { prisma } from '@/server/db';
import { getQueueCounts } from '@/server/queue/lms-sync.queue';
import { pingRedis } from '@/server/queue/redis';
import { listPublicRegistry } from '@/server/services/lms';

/**
 * GET /api/v1/university/diagnostics
 * Aggregate health snapshot for the University Sync platform: per-connection
 * status, recent SyncLog aggregates, queue + Redis + Postgres health, and the
 * public registry summary. Powers /university/diagnostics.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);

  const connections = await prisma.lmsConnection.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      provider: true,
      displayName: true,
      portalUrl: true,
      status: true,
      statusDetail: true,
      adapterVersion: true,
      lastSyncAt: true,
      tokenExpiresAt: true,
      autoSync: true,
      syncInterval: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Per-connection last successful + failed sync + retry count.
  const perConnection = await Promise.all(
    connections.map(async (conn) => {
      const [lastSuccess, lastFail, failedCount, avg] = await Promise.all([
        prisma.syncLog.findFirst({
          where: { connectionId: conn.id, status: 'COMPLETED', dryRun: false },
          orderBy: { startedAt: 'desc' },
          select: {
            startedAt: true,
            endedAt: true,
            apiRequestsMade: true,
            avgResponseTimeMs: true,
            queueWaitMs: true,
            queueExecutionMs: true,
          },
        }),
        prisma.syncLog.findFirst({
          where: { connectionId: conn.id, status: 'FAILED' },
          orderBy: { startedAt: 'desc' },
          select: { startedAt: true, errors: true },
        }),
        prisma.syncLog.count({ where: { connectionId: conn.id, status: 'FAILED' } }),
        prisma.syncLog.aggregate({
          where: { connectionId: conn.id, status: 'COMPLETED', dryRun: false },
          _avg: { avgResponseTimeMs: true, queueWaitMs: true, queueExecutionMs: true },
        }),
      ]);
      return {
        ...conn,
        lastSuccessfulSync: lastSuccess,
        lastFailedSync: lastFail,
        totalFailedSyncs: failedCount,
        avgApiResponseMs: Math.round(avg._avg.avgResponseTimeMs ?? 0),
        avgQueueWaitMs: Math.round(avg._avg.queueWaitMs ?? 0),
        avgQueueExecutionMs: Math.round(avg._avg.queueExecutionMs ?? 0),
      };
    }),
  );

  // Recent errors across all the user's connections.
  const recentErrors = await prisma.syncLog.findMany({
    where: { userId: user.id, status: 'FAILED' },
    orderBy: { startedAt: 'desc' },
    take: 20,
    include: {
      connection: { select: { displayName: true, provider: true } },
    },
  });

  // Postgres liveness + Redis + queue.
  const [postgres, redis] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1 as ok`,
    env.hasRedis ? pingRedis() : Promise.resolve({ ok: false, error: 'REDIS_URL not set' }),
  ]);
  const queue = env.hasRedis ? await getQueueCounts().catch(() => null) : null;

  return ok({
    connections: perConnection,
    recentErrors,
    infrastructure: {
      postgres:
        postgres.status === 'fulfilled'
          ? { ok: true }
          : { ok: false, error: (postgres.reason as Error)?.message },
      redis: redis.status === 'fulfilled' ? redis.value : { ok: false, error: (redis.reason as Error)?.message },
      queue,
      workerMode: env.LMS_WORKER_IN_WEB ? 'in-web' : 'standalone',
    },
    providers: listPublicRegistry(),
  });
});
