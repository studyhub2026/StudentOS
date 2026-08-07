import 'server-only';
import IORedis, { type Redis, type RedisOptions } from 'ioredis';
import { env } from '@/server/env';
import { logger } from '@/server/lib/logger';

/**
 * Shared ioredis connections for BullMQ.
 *
 * BullMQ requires connections created with `maxRetriesPerRequest: null` and
 * `enableReadyCheck: false` for its blocking commands. Everything else (queue
 * events, health checks) uses a separate "commander" connection with defaults,
 * so an unresponsive queue never blocks a health probe.
 *
 * We create both lazily so importing this module never throws if REDIS_URL is
 * unset — callers check `hasRedis` before enqueueing. On disconnect, ioredis
 * reconnects automatically with exponential backoff.
 */

let workerConn: Redis | null = null;
let commanderConn: Redis | null = null;

function makeConnection(kind: 'worker' | 'commander'): Redis {
  if (!env.REDIS_URL) {
    throw new Error('REDIS_URL is required for BullMQ queues');
  }
  const opts: RedisOptions = {
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 5000),
    reconnectOnError: (err) => {
      logger.warn({ err: err.message }, `redis:${kind} reconnect on error`);
      return true;
    },
    ...(kind === 'worker'
      ? { maxRetriesPerRequest: null, enableReadyCheck: false }
      : {}),
  };
  const conn = new IORedis(env.REDIS_URL, opts);
  conn.on('error', (err: Error) => {
    logger.warn({ err: err.message, kind }, 'redis connection error');
  });
  conn.on('ready', () => {
    logger.info({ kind }, 'redis ready');
  });
  return conn;
}

export function getWorkerConnection(): Redis {
  workerConn ??= makeConnection('worker');
  return workerConn;
}

export function getCommanderConnection(): Redis {
  commanderConn ??= makeConnection('commander');
  return commanderConn;
}

/** Fast liveness probe for the health check endpoint. */
export async function pingRedis(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  if (!env.REDIS_URL) return { ok: false, error: 'REDIS_URL not set' };
  try {
    const conn = getCommanderConnection();
    const start = Date.now();
    const reply = await conn.ping();
    return { ok: reply === 'PONG', latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
