import 'server-only';
import crypto from 'node:crypto';
import type { Role, User } from '@prisma/client';
import { prisma } from '@/server/db';
import { logger } from '@/server/lib/logger';
import {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
} from '@/server/lib/errors';
import { generateOpaqueToken, hashToken } from '@/server/lib/jwt';
import { hashPassword, verifyPassword } from '@/server/lib/password';
import { emailService } from '@/server/services/email.service';
import type { OAuthProfile, ProviderKey } from '@/server/services/oauth.service';
import { oauthService } from '@/server/services/oauth.service';
import { sessionService } from '@/server/services/session.service';
import { tokenService, type TokenPair } from '@/server/services/token.service';
import { totpService } from '@/server/services/totp.service';

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  role: Role;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  currentStreak: number;
  totalXp: number;
  createdAt: Date;
}

export interface AuthResult {
  user: PublicUser;
  tokens: TokenPair;
}

export interface RequestContext {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    emailVerified: user.emailVerified,
    twoFactorEnabled: user.twoFactorEnabled,
    currentStreak: user.currentStreak,
    totalXp: user.totalXp,
    createdAt: user.createdAt,
  };
}

async function issueVerificationToken(userId: string): Promise<string> {
  const token = generateOpaqueToken();

  await prisma.verificationToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      purpose: 'EMAIL_VERIFICATION',
      expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
    },
  });

  return token;
}

async function startSession(
  user: User,
  context: RequestContext,
  rememberMe: boolean,
): Promise<AuthResult> {
  const sessionId = await sessionService.createSession({
    userId: user.id,
    userAgent: context.userAgent,
    ipAddress: context.ipAddress,
    rememberMe,
  });

  const tokens = await tokenService.issueTokens({
    userId: user.id,
    email: user.email,
    role: user.role,
    sessionId,
  });

  return { user: toPublicUser(user), tokens };
}

// --- Registration -----------------------------------------------------------

export async function register(
  input: { email: string; username: string; name: string; password: string },
  context: RequestContext,
): Promise<AuthResult> {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: input.email }, { username: input.username }] },
    select: { email: true, username: true },
  });

  if (existing) {
    throw new ConflictError(
      existing.email === input.email
        ? 'An account with that email already exists'
        : 'That username is taken',
    );
  }

  const passwordHash = await hashPassword(input.password);

  // Settings are created alongside the user so the rest of the app can assume
  // they exist rather than null-checking on every read.
  const user = await prisma.user.create({
    data: {
      email: input.email,
      username: input.username,
      name: input.name,
      passwordHash,
      settings: { create: {} },
    },
  });

  const token = await issueVerificationToken(user.id);
  await emailService.sendVerificationEmail(user.email, token);

  logger.info({ userId: user.id }, 'user registered');

  return startSession(user, context, false);
}

// --- Login ------------------------------------------------------------------

export async function login(
  input: { email: string; password: string; totp?: string | undefined; rememberMe?: boolean },
  context: RequestContext,
): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Identical error for unknown email and wrong password so the response
  // cannot be used to enumerate registered accounts.
  const invalid = new UnauthorizedError('Incorrect email or password');

  if (!user?.passwordHash) {
    // Equalise timing against the hash comparison in the success path, so a
    // fast rejection does not reveal that the address is unregistered.
    await hashPassword(input.password);
    throw invalid;
  }
  if (user.deletedAt) throw invalid;

  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  if (!passwordOk) throw invalid;

  if (user.twoFactorEnabled) {
    if (!input.totp) {
      throw new BadRequestError('Two-factor code required', { twoFactorRequired: true });
    }
    if (!user.twoFactorSecret || !totpService.verifyCode(user.twoFactorSecret, input.totp, user.email)) {
      throw new UnauthorizedError('That two-factor code is not valid');
    }
  }

  return startSession(user, context, input.rememberMe ?? false);
}

// --- Logout -----------------------------------------------------------------

export async function logout(sessionId: string, refreshToken?: string): Promise<void> {
  if (refreshToken) await tokenService.revokeToken(refreshToken);

  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// --- Email verification -----------------------------------------------------

export async function verifyEmail(token: string): Promise<void> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, purpose: true, expiresAt: true, consumedAt: true },
  });

  if (
    !record ||
    record.purpose !== 'EMAIL_VERIFICATION' ||
    record.consumedAt ||
    record.expiresAt < new Date()
  ) {
    throw new BadRequestError('This verification link is invalid or has expired');
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    }),
    prisma.verificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
  ]);
}

export async function resendVerification(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });

  if (!user) throw new BadRequestError('User not found');
  if (user.emailVerified) throw new BadRequestError('Your email is already verified');

  // Invalidate outstanding links so only the newest one works.
  await prisma.verificationToken.updateMany({
    where: { userId, purpose: 'EMAIL_VERIFICATION', consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const token = await issueVerificationToken(userId);
  await emailService.sendVerificationEmail(user.email, token);
}

// --- Password reset ---------------------------------------------------------

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, deletedAt: true },
  });

  // Always returns success to the caller; revealing whether an address is
  // registered would leak account existence.
  if (!user || user.deletedAt) {
    logger.debug({ email }, 'password reset requested for unknown address');
    return;
  }

  await prisma.verificationToken.updateMany({
    where: { userId: user.id, purpose: 'PASSWORD_RESET', consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const token = generateOpaqueToken();
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      purpose: 'PASSWORD_RESET',
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  await emailService.sendPasswordResetEmail(user.email, token);
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, purpose: true, expiresAt: true, consumedAt: true },
  });

  if (
    !record ||
    record.purpose !== 'PASSWORD_RESET' ||
    record.consumedAt ||
    record.expiresAt < new Date()
  ) {
    throw new BadRequestError('This reset link is invalid or has expired');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.verificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
  ]);

  // A reset is the response to a suspected compromise — drop every session.
  await sessionService.revokeAllSessions(record.userId);

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { email: true },
  });
  if (user) await emailService.sendPasswordChangedEmail(user.email);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, passwordHash: true },
  });

  if (!user?.passwordHash) {
    throw new BadRequestError('This account signs in with a social provider and has no password');
  }
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new UnauthorizedError('Your current password is incorrect');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  await sessionService.revokeOtherSessions(userId, keepSessionId);
  await emailService.sendPasswordChangedEmail(user.email);
}

// --- OAuth ------------------------------------------------------------------

/**
 * Resolves an OAuth profile to a session, in three cases: a returning linked
 * account, an existing local account being linked for the first time, or a
 * brand-new user.
 */
export async function loginWithOAuth(
  provider: ProviderKey,
  profile: OAuthProfile,
  accessToken: string,
  context: RequestContext,
): Promise<AuthResult> {
  const providerEnum = oauthService.toProviderEnum(provider);

  const linked = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: providerEnum,
        providerAccountId: profile.providerAccountId,
      },
    },
    select: { user: true },
  });

  if (linked) {
    if (linked.user.deletedAt) throw new UnauthorizedError('Account is no longer active');
    await prisma.oAuthAccount.update({
      where: {
        provider_providerAccountId: {
          provider: providerEnum,
          providerAccountId: profile.providerAccountId,
        },
      },
      data: { accessToken },
    });
    return startSession(linked.user, context, true);
  }

  const existing = await prisma.user.findUnique({ where: { email: profile.email } });

  if (existing) {
    if (existing.deletedAt) throw new UnauthorizedError('Account is no longer active');

    // Only auto-link when the provider vouches for the address. Linking on an
    // unverified email would let an attacker who controls a provider account
    // claim someone else's StudentOS account.
    if (!profile.emailVerified) {
      throw new ConflictError(
        'An account with that email already exists. Sign in with your password, then link this provider from settings.',
      );
    }

    await prisma.oAuthAccount.create({
      data: {
        userId: existing.id,
        provider: providerEnum,
        providerAccountId: profile.providerAccountId,
        accessToken,
      },
    });

    logger.info({ userId: existing.id, provider }, 'linked oauth provider to existing account');
    return startSession(existing, context, true);
  }

  const username = await deriveUniqueUsername(profile.email);

  const user = await prisma.user.create({
    data: {
      email: profile.email,
      username,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      // The provider already confirmed the address; a second round trip would
      // add friction without adding assurance.
      emailVerified: profile.emailVerified,
      emailVerifiedAt: profile.emailVerified ? new Date() : null,
      settings: { create: {} },
      accounts: {
        create: {
          provider: providerEnum,
          providerAccountId: profile.providerAccountId,
          accessToken,
        },
      },
    },
  });

  logger.info({ userId: user.id, provider }, 'user registered via oauth');
  return startSession(user, context, true);
}

/**
 * Builds a username from the email local part, appending a random suffix on
 * collision. Bounded retries avoid an unbounded loop under contention.
 */
async function deriveUniqueUsername(email: string): Promise<string> {
  const base =
    (email.split('@')[0] ?? 'student').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'student';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate =
      attempt === 0 ? base : `${base}-${crypto.randomBytes(3).toString('hex')}`;
    const taken = await prisma.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }

  return `${base}-${crypto.randomBytes(6).toString('hex')}`;
}

export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) throw new UnauthorizedError('Account is no longer active');
  return toPublicUser(user);
}

export const authService = {
  register,
  login,
  logout,
  verifyEmail,
  resendVerification,
  requestPasswordReset,
  resetPassword,
  changePassword,
  loginWithOAuth,
  getCurrentUser,
  toPublicUser,
} as const;
