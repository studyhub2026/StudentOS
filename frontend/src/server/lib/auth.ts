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
 * Verifies the access token and confirms the session is still live.
 *
 * The session lookup costs one query per request but makes logout and remote
 * session revocation take effect immediately rather than at token expiry.
 * Called at the top of every protected route handler (Node runtime — Prisma
 * cannot run on the Edge).
 */
export async function requireAuth(req: NextRequest): Promise<AuthUser> {
  const token = extractBearer(req.headers.get('authorization'));
  if (!token) throw new UnauthorizedError('Missing access token');

  const payload = verifyAccessToken(token);

  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    select: {
      revokedAt: true,
      expiresAt: true,
      user: { select: { id: true, email: true, role: true, deletedAt: true } },
    },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new UnauthorizedError('Session expired or revoked');
  }
  if (session.user.deletedAt) {
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
