import 'server-only';
import { Queue, QueueEvents } from 'bullmq';
import { env } from '@/server/env';
import { logger } from '@/server/lib/logger';
import { getWorkerConnection, getCommanderConnection } from './redis';

/**
 * BullMQ queue for LMS sync jobs.
 *
 * Two kinds of jobs are added:
 *   - "sync-connection" — a one-off sync triggered by the user or the scheduler.
 *   - Repeatable variants of the above, keyed per connection, so BullMQ's own
 *     scheduler fires them every N minutes. Repeatable jobs are managed here
 *     via `scheduleAutoSync` / `unscheduleAutoSync`.
 *
 * Failed jobs retry up to 5 times with exponential backoff starting at 30s.
 */

export const LMS_SYNC_QUEUE = 'lms-sync';

export interface LmsSyncJobData {
  connectionId: string;
  userId: string;
  /** True when this run was fired by the scheduler, false for manual triggers. */
  scheduled: boolean;
}

let queue: Queue<LmsSyncJobData> | null = null;
let events: QueueEvents | null = null;

export function getLmsQueue(): Queue<LmsSyncJobData> {
  if (!env.hasRedis) {
    throw new Error('Cannot use LMS queue: REDIS_URL is not configured');
  }
  queue ??= new Queue<LmsSyncJobData>(LMS_SYNC_QUEUE, {
    connection: getWorkerConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 24 * 3600, count: 500 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return queue;
}

/** For the /queue-status endpoint. Uses a commander connection. */
export function getLmsQueueEvents(): QueueEvents {
  events ??= new QueueEvents(LMS_SYNC_QUEUE, { connection: getCommanderConnection() });
  return events;
}

/**
 * Enqueue a manual sync run. Returns the job id. Deduplicates by
 * `jobId = manual:{connectionId}` so double-clicks don't produce two jobs.
 */
export async function enqueueManualSync(connectionId: string, userId: string): Promise<string> {
  const q = getLmsQueue();
  const job = await q.add(
    'sync-connection',
    { connectionId, userId, scheduled: false },
    { jobId: `manual:${connectionId}:${Date.now()}` },
  );
  return job.id!;
}

/**
 * Register (or refresh) a repeatable job that syncs this connection every
 * `intervalMinutes`. Idempotent: BullMQ's upsertJobScheduler replaces the
 * schedule for the same id, so a settings change (60m → 10m) takes effect on
 * the next tick.
 */
export async function scheduleAutoSync(
  connectionId: string,
  userId: string,
  intervalMinutes: number,
): Promise<void> {
  const q = getLmsQueue();
  await q.upsertJobScheduler(
    `auto:${connectionId}`,
    { every: intervalMinutes * 60_000 },
    {
      name: 'sync-connection',
      data: { connectionId, userId, scheduled: true },
    },
  );
  logger.info({ connectionId, intervalMinutes }, 'lms: auto-sync scheduled');
}

export async function unscheduleAutoSync(connectionId: string): Promise<void> {
  const q = getLmsQueue();
  await q.removeJobScheduler(`auto:${connectionId}`);
}

/** Counts by state, for the queue status UI + health check. */
export async function getQueueCounts(): Promise<{
  active: number;
  waiting: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const q = getLmsQueue();
  const counts = await q.getJobCounts('active', 'waiting', 'completed', 'failed', 'delayed');
  return {
    active: counts.active ?? 0,
    waiting: counts.waiting ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
  };
}
