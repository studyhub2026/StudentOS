import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { env } from '@/server/env';
import { pingRedis } from '@/server/queue/redis';

/**
 * GET /api/v1/health
 * Simple liveness + dependency probe. Returns 200 if the web process is up,
 * even when a dependency is down — the body carries per-dependency status so
 * an orchestrator can distinguish "process alive but degraded" from "dead".
 */
export const GET = async () => {
  const [postgres, redis] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1 as ok`,
    env.hasRedis ? pingRedis() : Promise.resolve({ ok: true, note: 'not configured' }),
  ]);

  const postgresOk = postgres.status === 'fulfilled';
  const redisOk =
    redis.status === 'fulfilled' && ('ok' in redis.value ? redis.value.ok : true);

  return NextResponse.json(
    {
      ok: true,
      dependencies: {
        postgres: postgres.status === 'fulfilled'
          ? { ok: postgresOk }
          : { ok: false, error: (postgres.reason as Error)?.message },
        redis: redis.status === 'fulfilled' ? redis.value : { ok: false, error: (redis.reason as Error)?.message },
      },
      environment: {
        nodeEnv: env.NODE_ENV,
        hasGemini: env.hasGemini,
        hasRedis: env.hasRedis,
        hasCanvasOAuth: env.hasCanvasOAuth,
        workerMode: env.LMS_WORKER_IN_WEB ? 'in-web' : 'standalone',
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
};
