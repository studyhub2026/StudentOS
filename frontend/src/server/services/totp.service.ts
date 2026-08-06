import 'server-only';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { prisma } from '@/server/db';
import { BadRequestError } from '@/server/lib/errors';

/**
 * TOTP-based two-factor authentication (RFC 6238), compatible with Google
 * Authenticator, 1Password, Authy and similar.
 */

const ISSUER = 'OmnelOS';
const DIGITS = 6;
const PERIOD_SECONDS = 30;
/**
 * Accept the adjacent time steps so a user whose clock drifts by a few seconds
 * can still authenticate. Wider windows meaningfully weaken the factor.
 */
const VALIDATION_WINDOW = 1;

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

function buildTotp(secret: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

/**
 * Generates a secret and enrolment QR code. The secret is returned but not yet
 * activated — the user must prove possession with a valid code first.
 */
export async function generateSetup(email: string): Promise<TotpSetup> {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = buildTotp(secret.base32, email);
  const otpauthUrl = totp.toString();

  return {
    secret: secret.base32,
    otpauthUrl,
    qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl, {
      margin: 1,
      width: 240,
      color: { dark: '#0a0a0f', light: '#ffffff' },
    }),
  };
}

export function verifyCode(secret: string, code: string, email: string): boolean {
  const totp = buildTotp(secret, email);
  // `validate` returns the time-step delta, or null when no step matches.
  return totp.validate({ token: code, window: VALIDATION_WINDOW }) !== null;
}

/**
 * Activates 2FA after confirming the user can produce a valid code from the
 * secret they just enrolled.
 */
export async function enable(userId: string, secret: string, code: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, twoFactorEnabled: true },
  });

  if (!user) throw new BadRequestError('User not found');
  if (user.twoFactorEnabled) {
    throw new BadRequestError('Two-factor authentication is already enabled');
  }
  if (!verifyCode(secret, code, user.email)) {
    throw new BadRequestError('That code is not valid. Check your authenticator app and try again.');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true, twoFactorSecret: secret },
  });
}

export async function disable(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, twoFactorEnabled: true, twoFactorSecret: true },
  });

  if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
    throw new BadRequestError('Two-factor authentication is not enabled');
  }
  if (!verifyCode(user.twoFactorSecret, code, user.email)) {
    throw new BadRequestError('That code is not valid');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });
}

export const totpService = {
  generateSetup,
  verifyCode,
  enable,
  disable,
} as const;
