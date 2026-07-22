import { prisma } from '../config/prisma.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';

export interface CreateSessionParams {
  userId: string;
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
  /** "Remember me" extends the session from 7 to 30 days. */
  rememberMe?: boolean;
}

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastSeenAt: Date;
  createdAt: Date;
  expiresAt: Date;
  current: boolean;
}

const SHORT_SESSION_DAYS = 7;
const LONG_SESSION_DAYS = 30;

export async function createSession(params: CreateSessionParams): Promise<string> {
  const days = params.rememberMe ? LONG_SESSION_DAYS : SHORT_SESSION_DAYS;

  const session = await prisma.session.create({
    data: {
      userId: params.userId,
      userAgent: params.userAgent ?? null,
      ipAddress: params.ipAddress ?? null,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });

  return session.id;
}

export async function listSessions(
  userId: string,
  currentSessionId: string,
): Promise<SessionSummary[]> {
  const sessions = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: {
      id: true,
      userAgent: true,
      ipAddress: true,
      lastSeenAt: true,
      createdAt: true,
      expiresAt: true,
    },
  });

  return sessions.map((session) => ({
    ...session,
    current: session.id === currentSessionId,
  }));
}

/** Revokes one session and every refresh token issued against it. */
export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { userId: true, revokedAt: true },
  });

  if (!session || session.revokedAt) throw new NotFoundError('Session');
  if (session.userId !== userId) throw new ForbiddenError('You cannot revoke this session');

  await prisma.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revokes every session except the one supplied — the "sign out everywhere
 * else" action, and the correct response to a password change.
 */
export async function revokeOtherSessions(
  userId: string,
  keepSessionId: string,
): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null, id: { not: keepSessionId } },
    data: { revokedAt: new Date() },
  });

  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return result.count;
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

export const sessionService = {
  createSession,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  revokeAllSessions,
} as const;
