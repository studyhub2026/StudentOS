import { PrismaClient } from '@prisma/client';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * A single PrismaClient per process. In development the instance is cached on
 * `globalThis` so tsx's hot reload does not exhaust the connection pool.
 */
// The log array must stay an inline literal here: extracting it, or building
// it with a ternary, widens the element type and collapses the `$on` event
// payloads to `never`.
function createPrismaClient() {
  return new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });
}

/**
 * Derived from the factory so the cached instance keeps its log-event generic.
 * Typing this as a bare `PrismaClient` would erase the event payload types.
 */
type AppPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as { prisma?: AppPrismaClient };

export const prisma: AppPrismaClient = globalForPrisma.prisma ?? createPrismaClient();

prisma.$on('query', (event) => {
  // Only surface slow queries — full query logging drowns the dev console.
  if (env.isDevelopment && event.duration >= 200) {
    logger.debug({ durationMs: event.duration, query: event.query }, 'slow query');
  }
});

if (env.isDevelopment) {
  globalForPrisma.prisma = prisma;
}

prisma.$on('warn', (event) => logger.warn({ target: event.target }, event.message));
prisma.$on('error', (event) => logger.error({ target: event.target }, event.message));

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('database connected');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('database disconnected');
}
