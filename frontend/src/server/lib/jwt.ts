import 'server-only';
import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '@/server/env';
import { UnauthorizedError } from '@/server/lib/errors';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
  sid: string;
}

export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  /**
   * Token family id. Reuse of a rotated refresh token revokes the whole
   * family, which contains the blast radius of a stolen token.
   */
  fam: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: 'studentos-ai',
    audience: 'studentos-api',
  } as SignOptions);
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
    issuer: 'studentos-ai',
    audience: 'studentos-api',
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'studentos-ai',
      audience: 'studentos-api',
    }) as AccessTokenPayload;
  } catch {
    throw new UnauthorizedError('Invalid or expired access token');
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: 'studentos-ai',
      audience: 'studentos-api',
    }) as RefreshTokenPayload;
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }
}

/** Refresh tokens are stored hashed so a database leak cannot be replayed. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}
