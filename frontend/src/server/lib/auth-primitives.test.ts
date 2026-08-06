import { describe, expect, it } from 'vitest';
import * as OTPAuth from 'otpauth';
import {
  generateOpaqueToken,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './jwt';
import { hashPassword, verifyPassword } from './password';
import { totpService } from '@/server/services/totp.service';
import { oauthService } from '@/server/services/oauth.service';
import {
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@/server/validators/auth.validator';

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const digest = await hashPassword('CorrectHorse42');
    expect(await verifyPassword(digest, 'CorrectHorse42')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const digest = await hashPassword('CorrectHorse42');
    expect(await verifyPassword(digest, 'WrongHorse42')).toBe(false);
  });

  it('produces a distinct digest per call (salted)', async () => {
    const [a, b] = await Promise.all([hashPassword('SamePass99'), hashPassword('SamePass99')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'SamePass99')).toBe(true);
    expect(await verifyPassword(b, 'SamePass99')).toBe(true);
  });

  it('uses argon2id', async () => {
    expect(await hashPassword('AnyPassword1')).toMatch(/^\$argon2id\$/);
  });

  it('treats a malformed digest as a failed match rather than throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'AnyPassword1')).toBe(false);
  });
});

describe('jwt', () => {
  const payload = {
    sub: 'user_123',
    email: 'a@b.com',
    role: 'STUDENT' as const,
    sid: 'session_1',
  };

  it('round-trips an access token', () => {
    const decoded = verifyAccessToken(signAccessToken(payload));
    expect(decoded.sub).toBe('user_123');
    expect(decoded.sid).toBe('session_1');
    expect(decoded.role).toBe('STUDENT');
  });

  it('round-trips a refresh token', () => {
    const decoded = verifyRefreshToken(
      signRefreshToken({ sub: 'user_123', sid: 'session_1', fam: 'fam_1' }),
    );
    expect(decoded.fam).toBe('fam_1');
  });

  it('rejects a tampered token', () => {
    const token = signAccessToken(payload);
    const tampered = `${token.slice(0, -4)}AAAA`;
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it('will not accept a refresh token as an access token', () => {
    // The two are signed with different secrets, so cross-use must fail.
    const refresh = signRefreshToken({ sub: 'u', sid: 's', fam: 'f' });
    expect(() => verifyAccessToken(refresh)).toThrow();
  });

  it('hashes tokens deterministically and irreversibly', () => {
    const token = generateOpaqueToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toHaveLength(64);
  });

  it('generates unique opaque tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(100);
  });
});

describe('totp', () => {
  it('accepts a code generated from the enrolled secret', async () => {
    const setup = await totpService.generateSetup('student@example.com');
    const code = new OTPAuth.TOTP({
      issuer: 'OmnelOS',
      label: 'student@example.com',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(setup.secret),
    }).generate();

    expect(totpService.verifyCode(setup.secret, code, 'student@example.com')).toBe(true);
  });

  it('rejects an incorrect code', async () => {
    const setup = await totpService.generateSetup('student@example.com');
    expect(totpService.verifyCode(setup.secret, '000000', 'student@example.com')).toBe(false);
  });

  it('rejects a code generated from a different secret', async () => {
    const [a, b] = await Promise.all([
      totpService.generateSetup('student@example.com'),
      totpService.generateSetup('student@example.com'),
    ]);
    const codeFromB = new OTPAuth.TOTP({
      issuer: 'OmnelOS',
      label: 'student@example.com',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(b.secret),
    }).generate();

    expect(totpService.verifyCode(a.secret, codeFromB, 'student@example.com')).toBe(false);
  });

  it('produces a scannable enrolment payload', async () => {
    const setup = await totpService.generateSetup('student@example.com');
    expect(setup.otpauthUrl).toContain('otpauth://totp/');
    expect(setup.otpauthUrl).toContain('OmnelOS');
    expect(setup.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

describe('oauth state', () => {
  it('round-trips state for the matching provider', () => {
    const state = oauthService.createState('google', '/dashboard');
    expect(oauthService.verifyState(state, 'google').redirectTo).toBe('/dashboard');
  });

  it('rejects state replayed against a different provider', () => {
    const state = oauthService.createState('google');
    expect(() => oauthService.verifyState(state, 'github')).toThrow();
  });

  it('rejects tampered state', () => {
    const state = oauthService.createState('google');
    expect(() => oauthService.verifyState(`${state.slice(0, -4)}AAAA`, 'google')).toThrow();
  });

  it('reports providers as unconfigured when no credentials are set', () => {
    // No OAuth credentials exist in the test environment.
    expect(oauthService.listConfiguredProviders()).toEqual([]);
  });
});

describe('auth validators', () => {
  it('normalises email casing and whitespace', () => {
    const parsed = registerSchema.parse({
      email: '  Student@Example.COM ',
      username: 'student',
      name: 'Student',
      password: 'ValidPass123',
    });
    expect(parsed.email).toBe('student@example.com');
  });

  it.each([
    ['too short', 'Short1'],
    ['no uppercase', 'alllowercase123'],
    ['no lowercase', 'ALLUPPERCASE123'],
    ['no digit', 'NoDigitsHereAtAll'],
  ])('rejects a password that is %s', (_label, password) => {
    expect(resetPasswordSchema.safeParse({ token: 't', password }).success).toBe(false);
  });

  it('accepts a compliant password', () => {
    expect(resetPasswordSchema.safeParse({ token: 't', password: 'ValidPass123' }).success).toBe(
      true,
    );
  });

  it('rejects usernames with disallowed characters', () => {
    const result = registerSchema.safeParse({
      email: 'a@b.com',
      username: 'bad user!',
      name: 'A',
      password: 'ValidPass123',
    });
    expect(result.success).toBe(false);
  });

  it('requires a 6-digit totp when supplied', () => {
    const base = { email: 'a@b.com', password: 'x' };
    expect(loginSchema.safeParse({ ...base, totp: '12345' }).success).toBe(false);
    expect(loginSchema.safeParse({ ...base, totp: '123456' }).success).toBe(true);
    expect(loginSchema.safeParse(base).success).toBe(true);
  });
});
