// Named import: ioredis is CJS, and its default export is not callable when
// consumed from an ES module.
import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Redis is optional. When REDIS_URL is unset the app runs single-instance with
 * in-process caching, which is fine for local development but not for a
 * horizontally scaled deployment.
 */
let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (!env.hasRedis) return null;
  if (client) return client;

  client = new Redis(env.REDIS_URL as string, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy: (attempt) => Math.min(attempt * 200, 3000),
  });

  client.on('error', (error) => logger.error({ err: error }, 'redis error'));
  client.on('connect', () => logger.info('redis connected'));

  return client;
}

export async function connectRedis(): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    logger.warn('REDIS_URL not set — running with in-process cache only');
    return;
  }
  await redis.connect();
}

export async function disconnectRedis(): Promise<void> {
  if (!client) return;
  await client.quit();
  client = null;
}
