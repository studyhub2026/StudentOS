import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { env } from '@/server/env';
import { getQueueCounts } from '@/server/queue/lms-sync.queue';
import { pingRedis } from '@/server/queue/redis';
import { ensureInWebWorker } from '@/server/queue/lms-sync.worker';

/**
 * GET /api/v1/university/queue-status
 * Returns Redis liveness and BullMQ job counters for the LMS sync queue.
 * Called by the UI on the University page to show sync health.
 *
 * Also warms up the in-web worker (idempotent) so the queue actually processes
 * jobs in dev / single-process deployments.
 */
export const GET = route(async (req: NextRequest) => {
  await requireAuth(req);

  if (!env.hasRedis) {
    return ok({
      enabled: false,
      redis: { ok: false, error: 'REDIS_URL not set' },
      counts: null,
      workerMode: env.LMS_WORKER_IN_WEB ? 'in-web' : 'standalone',
    });
  }

  ensureInWebWorker();

  const [redis, counts] = await Promise.all([
    pingRedis(),
    getQueueCounts().catch(() => null),
  ]);

  return ok({
    enabled: true,
    redis,
    counts,
    workerMode: env.LMS_WORKER_IN_WEB ? 'in-web' : 'standalone',
  });
});
