/**
 * Standalone BullMQ worker entrypoint.
 *
 *   npm run worker
 *
 * Used by docker-compose's `worker` service so heavy LMS sync work runs in a
 * separate process from the Next.js web server. This file is not `server-only`
 * because it is executed directly by node/tsx, not imported by app code.
 */
import { logger } from '@/server/lib/logger';
import { startLmsWorker, stopLmsWorker } from './lms-sync.worker';

async function main() {
  logger.info({ pid: process.pid }, 'lms worker: booting standalone process');
  const worker = startLmsWorker();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'lms worker: shutting down');
    try {
      await stopLmsWorker();
      await worker.close();
    } catch (err) {
      logger.error({ err }, 'lms worker: shutdown error');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'lms worker: uncaught exception');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'lms worker: unhandled rejection');
  });
}

void main();
