import type { Role } from '@prisma/client';
import type { RequestHandler } from 'express';
import { prisma } from '../config/prisma.js';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import { verifyAccessToken } from '../utils/jwt.js';

function extractToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Verifies the access token and confirms the session is still live.
 *
 * The session lookup costs a query per request but makes logout and remote
 * session revocation take effect immediately rather than at token expiry.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  void (async () => {
    try {
      const token = extractToken(req.headers.authorization);
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

      req.user = {
        id: session.user.id,
        email: session.user.email,
        role: session.user.role,
        sessionId: payload.sid,
      };

      next();
    } catch (error) {
      next(error);
    }
  })();
};

/** Attaches the user when a valid token is present, but never rejects. */
export const optionalAuth: RequestHandler = (req, res, next) => {
  if (!extractToken(req.headers.authorization)) {
    next();
    return;
  }
  requireAuth(req, res, (error) => {
    if (error) {
      next();
      return;
    }
    next();
  });
};

/** Restricts a route to the given roles. Must run after `requireAuth`. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}
