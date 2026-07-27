import 'server-only';
import { PrismaClient } from '@prisma/client';

/**
 * A single PrismaClient per server instance.
 *
 * On Vercel each serverless function is a short-lived instance, so the client
 * is cached on `globalThis` to survive hot reload in development and module
 * re-evaluation between invocations. Production must use the Supabase
 * connection **pooler** URL (port 6543) — a direct connection would exhaust
 * Postgres under serverless fan-out.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
