import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { authService } from '../services/auth.service.js';
import { oauthService, type ProviderKey } from '../services/oauth.service.js';
import { sessionService } from '../services/session.service.js';
import { tokenService } from '../services/token.service.js';
import { totpService } from '../services/totp.service.js';
import { env } from '../config/env.js';
import { BadRequestError, UnauthorizedError } from '../utils/errors.js';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  setRefreshCookie,
} from '../utils/cookies.js';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from '../validators/auth.validator.js';

function contextFrom(req: Request): { userAgent?: string; ipAddress?: string } {
  const userAgent = req.get('user-agent');
  return {
    ...(userAgent ? { userAgent } : {}),
    ...(req.ip ? { ipAddress: req.ip } : {}),
  };
}

/** Reads the refresh token from the cookie, falling back to the request body. */
function readRefreshToken(req: Request): string {
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
  const fromBody = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
  const token = fromCookie ?? fromBody;
  if (!token) throw new UnauthorizedError('No refresh token provided');
  return token;
}

function requireUser(req: Request): NonNullable<Request['user']> {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(req.body as RegisterInput, contextFrom(req));
  setRefreshCookie(res, result.tokens.refreshToken);

  res.status(201).json({
    success: true,
    data: {
      user: result.user,
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
    },
  });
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body as LoginInput, contextFrom(req));
  setRefreshCookie(res, result.tokens.refreshToken);

  res.json({
    success: true,
    data: {
      user: result.user,
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
    },
  });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const tokens = await tokenService.rotateRefreshToken(readRefreshToken(req));
  setRefreshCookie(res, tokens.refreshToken);

  res.json({
    success: true,
    data: { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn },
  });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];

  await authService.logout(user.sessionId, cookie);
  clearRefreshCookie(res);

  res.json({ success: true, data: { message: 'Signed out' } });
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  res.json({ success: true, data: await authService.getCurrentUser(user.id) });
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  await authService.verifyEmail((req.body as { token: string }).token);
  res.json({ success: true, data: { message: 'Email verified' } });
}

export async function resendVerification(req: Request, res: Response): Promise<void> {
  await authService.resendVerification(requireUser(req).id);
  res.json({ success: true, data: { message: 'Verification email sent' } });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  await authService.requestPasswordReset((req.body as { email: string }).email);

  // Deliberately unconditional — a different response for unknown addresses
  // would let anyone test which emails are registered.
  res.json({
    success: true,
    data: { message: 'If an account exists for that address, a reset link has been sent.' },
  });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, password } = req.body as ResetPasswordInput;
  await authService.resetPassword(token, password);
  clearRefreshCookie(res);
  res.json({ success: true, data: { message: 'Password reset. Please sign in.' } });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { currentPassword, newPassword } = req.body as ChangePasswordInput;

  await authService.changePassword(user.id, currentPassword, newPassword, user.sessionId);
  res.json({ success: true, data: { message: 'Password changed. Other sessions were signed out.' } });
}

// --- Two-factor -------------------------------------------------------------

export async function setup2fa(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const setup = await totpService.generateSetup(user.email);

  // The secret is returned but not persisted until `enable2fa` proves the
  // user can generate a valid code from it.
  res.json({
    success: true,
    data: {
      secret: setup.secret,
      otpauthUrl: setup.otpauthUrl,
      qrCode: setup.qrCodeDataUrl,
    },
  });
}

export async function enable2fa(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { secret, totp } = req.body as { secret?: string; totp: string };

  if (!secret) throw new BadRequestError('Missing enrolment secret. Restart two-factor setup.');

  await totpService.enable(user.id, secret, totp);
  res.json({ success: true, data: { message: 'Two-factor authentication enabled' } });
}

export async function disable2fa(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  await totpService.disable(user.id, (req.body as { totp: string }).totp);
  res.json({ success: true, data: { message: 'Two-factor authentication disabled' } });
}

// --- Sessions ---------------------------------------------------------------

export async function listSessions(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  res.json({ success: true, data: await sessionService.listSessions(user.id, user.sessionId) });
}

export async function revokeSession(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  await sessionService.revokeSession(user.id, req.params.id as string);
  res.json({ success: true, data: { message: 'Session revoked' } });
}

export async function revokeOtherSessions(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const count = await sessionService.revokeOtherSessions(user.id, user.sessionId);
  res.json({ success: true, data: { revoked: count } });
}

// --- OAuth ------------------------------------------------------------------

export function listOAuthProviders(_req: Request, res: Response): void {
  res.json({ success: true, data: { providers: oauthService.listConfiguredProviders() } });
}

export function oauthRedirect(req: Request, res: Response): void {
  const provider = req.params.provider as ProviderKey;
  const redirectTo = typeof req.query.redirectTo === 'string' ? req.query.redirectTo : undefined;

  const state = oauthService.createState(provider, redirectTo);
  res.redirect(oauthService.buildAuthorizeUrl(provider, state));
}

/**
 * Completes the OAuth flow and hands control back to the frontend.
 *
 * The refresh token is set as an httpOnly cookie; the frontend then calls
 * /auth/refresh to obtain an access token. Putting tokens in the redirect URL
 * would leak them into browser history and referrer headers.
 */
export async function oauthCallback(req: Request, res: Response): Promise<void> {
  const provider = req.params.provider as ProviderKey;
  const { code, state } = req.query as { code?: string; state?: string };

  if (!code || !state) {
    res.redirect(`${env.APP_URL}/login?error=oauth_cancelled`);
    return;
  }

  try {
    const { redirectTo } = oauthService.verifyState(state, provider);
    const accessToken = await oauthService.exchangeCode(provider, code);
    const profile = await oauthService.fetchProfile(provider, accessToken);

    const result = await authService.loginWithOAuth(provider, profile, accessToken, contextFrom(req));
    setRefreshCookie(res, result.tokens.refreshToken);

    const target = new URL('/auth/callback', env.APP_URL);
    if (redirectTo) target.searchParams.set('redirectTo', redirectTo);
    res.redirect(target.toString());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sign-in failed';
    res.redirect(`${env.APP_URL}/login?error=${encodeURIComponent(message)}`);
  }
}

/** Unlinks a provider, refusing when it is the only way into the account. */
export async function unlinkProvider(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const provider = req.params.provider as ProviderKey;
  const providerEnum = oauthService.toProviderEnum(provider);

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true, accounts: { select: { id: true, provider: true } } },
  });

  if (!account) throw new UnauthorizedError();

  const linked = account.accounts.find((entry) => entry.provider === providerEnum);
  if (!linked) throw new BadRequestError('That provider is not linked to your account');

  if (!account.passwordHash && account.accounts.length === 1) {
    throw new BadRequestError(
      'This is your only sign-in method. Set a password before unlinking it.',
    );
  }

  await prisma.oAuthAccount.delete({ where: { id: linked.id } });
  res.json({ success: true, data: { message: `${provider} unlinked` } });
}
