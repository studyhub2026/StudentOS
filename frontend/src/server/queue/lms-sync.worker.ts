import 'server-only';
import { Worker, type Job } from 'bullmq';
import { env } from '@/server/env';
import { logger } from '@/server/lib/logger';
import { getWorkerConnection } from './redis';
import { LMS_SYNC_QUEUE, type LmsSyncJobData } from './lms-sync.queue';

/**
 * BullMQ worker for LMS sync jobs.
 *
 * In development the worker runs inside the web process (LMS_WORKER_IN_WEB=true).
 * In production docker-compose it runs as a separate `worker` service so heavy
 * sync work never blocks HTTP requests.
 *
 * The actual sync logic lives in universitySyncService.runSyncJob, which the
 * worker imports lazily to avoid a circular dependency (queue file → service →
 * queue file).
 */

let worker: Worker<LmsSyncJobData> | null = null;

async function processJob(job: Job<LmsSyncJobData>): Promise<{ syncLogId: string }> {
  const { runSyncJob } = await import('@/server/services/university-sync.service');
  const start = Date.now();
  logger.info(
    { jobId: job.id, connectionId: job.data.connectionId, scheduled: job.data.scheduled },
    'lms worker: starting sync',
  );
  const result = await runSyncJob(job.data.userId, job.data.connectionId, {
    scheduled: job.data.scheduled,
    attempt: job.attemptsMade + 1,
  });
  logger.info(
    { jobId: job.id, connectionId: job.data.connectionId, ms: Date.now() - start },
    'lms worker: sync complete',
  );
  return result;
}

export function startLmsWorker(): Worker<LmsSyncJobData> {
  if (worker) return worker;
  if (!env.hasRedis) {
    throw new Error('startLmsWorker() called but REDIS_URL is not configured');
  }
  worker = new Worker<LmsSyncJobData>(LMS_SYNC_QUEUE, processJob, {
    connection: getWorkerConnection(),
    concurrency: env.LMS_WORKER_CONCURRENCY,
    // Limit each job to 10 minutes; anything longer is a stuck-in-adapter bug
    // and BullMQ should reclaim the lock.
    lockDuration: 10 * 60_000,
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, connectionId: job?.data.connectionId, attempt: job?.attemptsMade, err },
      'lms worker: job failed',
    );
  });
  worker.on('error', (err) => {
    logger.error({ err }, 'lms worker: runtime error');
  });
  worker.on('ready', () => logger.info({ concurrency: env.LMS_WORKER_CONCURRENCY }, 'lms worker: ready'));

  return worker;
}

export async function stopLmsWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = null;
}

/**
 * Ensures the worker is running when the web process owns it. Called from a
 * warm-up route so it initialises once per instance without wiring an
 * instrumentation-hook file.
 */
export function ensureInWebWorker(): void {
  if (env.LMS_WORKER_IN_WEB && env.hasRedis && !worker) {
    startLmsWorker();
  }
}
