import crypto from 'node:crypto';
import type { Role } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { UnauthorizedError } from '../utils/errors.js';
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../utils/jwt.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface IssueTokensParams {
  userId: string;
  email: string;
  role: Role;
  sessionId: string;
  /** Reuses the family on rotation; a fresh login starts a new family. */
  family?: string;
}

/** Access token lifetime in seconds, mirrored to clients for refresh timing. */
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_DAYS = 30;

function refreshExpiry(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Issues an access/refresh pair and persists the refresh token's hash.
 */
export async function issueTokens(params: IssueTokensParams): Promise<TokenPair> {
  const family = params.family ?? crypto.randomUUID();

  const accessToken = signAccessToken({
    sub: params.userId,
    email: params.email,
    role: params.role,
    sid: params.sessionId,
  });

  const refreshToken = signRefreshToken({
    sub: params.userId,
    sid: params.sessionId,
    fam: family,
  });

  await prisma.refreshToken.create({
    data: {
      userId: params.userId,
      tokenHash: hashToken(refreshToken),
      family,
      expiresAt: refreshExpiry(),
    },
  });

  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/**
 * Rotates a refresh token.
 *
 * Presenting a token that was already rotated means either a replay or a
 * stolen token, and we cannot tell which — so the entire family is revoked,
 * forcing a fresh login. This is the standard OAuth 2.0 BCP mitigation for
 * refresh token theft.
 */
export async function rotateRefreshToken(presentedToken: string): Promise<TokenPair> {
  const payload = verifyRefreshToken(presentedToken);
  const tokenHash = hashToken(presentedToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, family: true, revokedAt: true, expiresAt: true },
  });

  if (!stored) {
    // A signed token with no database record was already pruned or forged.
    await revokeFamily(payload.fam);
    throw new UnauthorizedError('Refresh token is no longer valid');
  }

  if (stored.revokedAt) {
    logger.warn(
      { userId: stored.userId, family: stored.family },
      'refresh token reuse detected — revoking family',
    );
    await revokeFamily(stored.family);
    throw new UnauthorizedError('Refresh token was already used. Please sign in again.');
  }

  if (stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token has expired');
  }

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

  const next = await issueTokens({
    userId: session.user.id,
    email: session.user.email,
    role: session.user.role,
    sessionId: payload.sid,
    family: stored.family,
  });

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedBy: hashToken(next.refreshToken) },
    }),
    prisma.session.update({
      where: { id: payload.sid },
      data: { lastSeenAt: new Date() },
    }),
  ]);

  return next;
}

/** Revokes every token in a family — used on reuse detection and logout. */
export async function revokeFamily(family: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { family, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeToken(token: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Removes expired and long-revoked tokens. Intended for a scheduled job. */
export async function pruneExpiredTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
    },
  });
  return result.count;
}

export const tokenService = {
  issueTokens,
  rotateRefreshToken,
  revokeFamily,
  revokeToken,
  pruneExpiredTokens,
  ACCESS_TOKEN_TTL_SECONDS,
} as const;
