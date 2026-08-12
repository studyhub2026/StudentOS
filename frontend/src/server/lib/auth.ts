import 'server-only';
import type { Role } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { ForbiddenError, UnauthorizedError } from '@/server/lib/errors';
import { verifyAccessToken } from '@/server/lib/jwt';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  sessionId: string;
}

function extractBearer(header: string | null): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Short-lived in-memory cache for session lookups.
 *
 * The JWT is already verified cryptographically on every request; the DB
 * session lookup only exists so that logout / remote-revocation take effect
 * before the JWT's natural expiry. A 30-second TTL cuts the amortised cost
 * of `requireAuth` from one full Postgres round-trip (200-300 ms with a
 * distant DB) to a Map lookup, while keeping revocation delay bounded.
 *
 * The cache lives per-Function-instance — on Vercel that's per-lambda, so a
 * fresh instance re-hits the DB once. It is intentionally a plain Map, not
 * an LRU: session ids churn slowly and each entry is ~200 bytes.
 */
interface CachedSession {
  expiresAtMs: number;   // when this cache entry itself expires
  session: {
    revokedAt: Date | null;
    expiresAt: Date;
    user: { id: string; email: string; role: Role; deletedAt: Date | null };
  };
}
const SESSION_TTL_MS = 30_000;
const sessionCache = new Map<string, CachedSession>();

export function invalidateAuthCache(sessionId: string): void {
  // Call this from `POST /auth/logout` and session-revocation flows so a
  // logged-out user can't keep making authed requests for up to TTL seconds.
  sessionCache.delete(sessionId);
}

/**
 * Verifies the access token and confirms the session is still live.
 *
 * Session lookups are cached for SESSION_TTL_MS to avoid one DB round-trip on
 * every API request. Logout / remote revocation calls `invalidateAuthCache`
 * so the effect is still immediate on the origin.
 * Node runtime — Prisma cannot run on the Edge.
 */
export async function requireAuth(req: NextRequest): Promise<AuthUser> {
  const token = extractBearer(req.headers.get('authorization'));
  if (!token) throw new UnauthorizedError('Missing access token');

  const payload = verifyAccessToken(token);

  const now = Date.now();
  const cached = sessionCache.get(payload.sid);
  let session: CachedSession['session'] | null;

  if (cached && cached.expiresAtMs > now) {
    session = cached.session;
  } else {
    const fresh = await prisma.session.findUnique({
      where: { id: payload.sid },
      select: {
        revokedAt: true,
        expiresAt: true,
        user: { select: { id: true, email: true, role: true, deletedAt: true } },
      },
    });
    session = fresh;
    if (fresh) {
      sessionCache.set(payload.sid, { expiresAtMs: now + SESSION_TTL_MS, session: fresh });
    } else {
      sessionCache.delete(payload.sid);
    }
  }

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    sessionCache.delete(payload.sid);
    throw new UnauthorizedError('Session expired or revoked');
  }
  if (session.user.deletedAt) {
    sessionCache.delete(payload.sid);
    throw new UnauthorizedError('Account is no longer active');
  }

  return {
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
    sessionId: payload.sid,
  };
}

/** Confirms the authenticated user holds one of the given roles. */
export function requireRole(user: AuthUser, ...roles: Role[]): void {
  if (!roles.includes(user.role)) {
    throw new ForbiddenError();
  }
}
