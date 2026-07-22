import http from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/prisma.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { closeSockets, initSockets } from './sockets/index.js';

async function bootstrap(): Promise<void> {
  await connectDatabase();
  await connectRedis();

  const app = createApp();
  const server = http.createServer(app);

  initSockets(server);

  server.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, ai: env.hasGemini ? 'gemini' : 'disabled' },
      `StudentOS AI API listening on ${env.API_URL}`,
    );
  });

  /**
   * Stop accepting connections, then release the database and Redis pools.
   * The timer guards against a connection that never drains.
   */
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(() => {
      void (async () => {
        try {
          await closeSockets();
          await disconnectRedis();
          await disconnectDatabase();
          clearTimeout(forceExit);
          process.exit(0);
        } catch (error) {
          logger.error({ err: error }, 'error during shutdown');
          process.exit(1);
        }
      })();
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    process.exit(1);
  });
}

bootstrap().catch((error: unknown) => {
  logger.fatal({ err: error }, 'failed to start server');
  process.exit(1);
});
