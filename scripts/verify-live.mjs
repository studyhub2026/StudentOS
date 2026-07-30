/**
 * End-to-end verification against the RUNNING Next.js app and the REAL Supabase
 * database. Covers steps 5-7: authentication, JWT, refresh-token rotation with
 * reuse detection, TOTP 2FA, RBAC, and a CRUD round-trip.
 *
 * Creates throwaway accounts and deletes them afterwards, so it is safe to
 * re-run and never touches the seeded demo data.
 *
 *   node --env-file=frontend/.env scripts/verify-live.mjs
 *
 * Requires the Next server running on http://localhost:3000.
 */
import crypto from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3000/api/v1';
const prisma = new PrismaClient();

const RUN = crypto.randomBytes(4).toString('hex');
const EMAIL = `live-${RUN}@studentos.test`;
const OTHER = `live-other-${RUN}@studentos.test`;
const PASSWORD = 'LivePassword123';

let passed = 0;
let failed = 0;
let section = '';
function group(name) { section = name; console.log(`\n--- ${name} ---`); }
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log(`PASS  ${label}`); }
  else { failed++; console.log(`FAIL  ${label}${detail ? `  (${detail})` : ''}`); }
}

let cookieJar = '';
async function api(method, path, { body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookieJar ? { Cookie: cookieJar } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookieJar = setCookie.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 160) }; }
  return { status: res.status, body: json };
}

async function run() {
  group('database connectivity');
  const tables = await prisma.$queryRaw`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`;
  check(`31 tables present (found ${tables[0].n})`, tables[0].n === 31);
  const demo = await prisma.user.findUnique({ where: { email: 'demo@studentos.ai' }, select: { id: true } });
  check('seeded demo user exists', Boolean(demo));

  group('registration');
  const reg = await api('POST', '/auth/register', { body: { email: EMAIL, username: `live${RUN}`, name: 'Live Runner', password: PASSWORD } });
  check('register returns 201', reg.status === 201, `got ${reg.status}`);
  let accessToken = reg.body?.data?.accessToken;
  check('register returns an access token', Boolean(accessToken));
  check('refresh cookie set', cookieJar.includes('sos_refresh'));
  const stored = await prisma.user.findUnique({ where: { email: EMAIL } });
  check('user row persisted', Boolean(stored));
  check('password hashed with argon2id', stored?.passwordHash?.startsWith('$argon2id$') === true);
  check('default settings row created', Boolean(await prisma.userSettings.findUnique({ where: { userId: stored.id } })));
  const dup = await api('POST', '/auth/register', { body: { email: EMAIL, username: `x${RUN}`, name: 'Dup', password: PASSWORD } });
  check('duplicate email rejected 409', dup.status === 409, `got ${dup.status}`);

  group('login + enumeration safety');
  cookieJar = '';
  const login = await api('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  check('login 200', login.status === 200);
  accessToken = login.body?.data?.accessToken;
  const wrongPw = await api('POST', '/auth/login', { body: { email: EMAIL, password: 'Nope12345678' } });
  const unknown = await api('POST', '/auth/login', { body: { email: `ghost-${RUN}@x.test`, password: PASSWORD } });
  check('wrong password 401', wrongPw.status === 401);
  check('unknown email 401', unknown.status === 401);
  check('wrong-password and unknown-email responses identical', JSON.stringify(wrongPw.body) === JSON.stringify(unknown.body));

  group('authenticated identity');
  const me = await api('GET', '/auth/me', { token: accessToken });
  check('/auth/me returns current user', me.body?.data?.email === EMAIL);
  check('no password hash leaked', !JSON.stringify(me.body).includes('argon2'));
  check('/auth/me without token 401', (await api('GET', '/auth/me')).status === 401);

  group('refresh token rotation + reuse detection');
  const firstJar = cookieJar;
  const refreshed = await api('POST', '/auth/refresh', { body: {} });
  check('refresh returns a new access token', Boolean(refreshed.body?.data?.accessToken));
  check('refresh rotates the cookie', cookieJar !== firstJar);
  const rotated = refreshed.body?.data?.accessToken;
  check('rotated access token works', (await api('GET', '/auth/me', { token: rotated })).status === 200);
  const savedJar = cookieJar;
  cookieJar = firstJar;
  const replay = await api('POST', '/auth/refresh', { body: {} });
  check('replaying old refresh token rejected', replay.status === 401, `got ${replay.status}`);
  cookieJar = savedJar;
  const afterReuse = await api('POST', '/auth/refresh', { body: {} });
  check('reuse detection revokes the whole family', afterReuse.status === 401, `got ${afterReuse.status}`);
  // The login family is revoked; the registration token is a separate family
  // and legitimately stays active, so assert revocation happened, not that
  // every token the user owns is dead.
  const revoked = await prisma.refreshToken.count({ where: { userId: stored.id, revokedAt: { not: null } } });
  check('reuse revoked the login family (>=2 tokens)', revoked >= 2, `revoked=${revoked}`);

  cookieJar = '';
  const relogin = await api('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  accessToken = relogin.body?.data?.accessToken;
  check('re-login after family revocation works', relogin.status === 200);

  group('two-factor authentication');
  const setup = await api('POST', '/auth/2fa/setup', { token: accessToken });
  const secret = setup.body?.data?.secret;
  check('2FA setup returns a secret', Boolean(secret));
  check('2FA setup returns a QR data URL', setup.body?.data?.qrCode?.startsWith('data:image/png;base64,') === true);
  const totp = new OTPAuth.TOTP({ issuer: 'StudentOS AI', label: EMAIL, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  check('2FA rejects a wrong code', (await api('POST', '/auth/2fa/enable', { token: accessToken, body: { secret, totp: '000000' } })).status === 400);
  check('2FA enables with a valid code', (await api('POST', '/auth/2fa/enable', { token: accessToken, body: { secret, totp: totp.generate() } })).status === 200);
  cookieJar = '';
  check('login now demands a 2FA code', (await api('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } })).status === 400);
  const login2fa = await api('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD, totp: totp.generate() } });
  check('login succeeds with a valid 2FA code', login2fa.status === 200);
  accessToken = login2fa.body?.data?.accessToken;
  await api('POST', '/auth/2fa/disable', { token: accessToken, body: { password: PASSWORD, totp: totp.generate() } });
  check('2FA can be disabled', (await prisma.user.findUnique({ where: { id: stored.id } }))?.twoFactorEnabled === false);

  group('RBAC');
  check('STUDENT denied on admin route (403)', (await api('GET', '/admin/overview', { token: accessToken })).status === 403);
  // Promote to ADMIN and re-login to pick up the new role in a fresh token.
  await prisma.user.update({ where: { id: stored.id }, data: { role: 'ADMIN' } });
  cookieJar = '';
  const adminLogin = await api('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  const adminToken = adminLogin.body?.data?.accessToken;
  const adminOverview = await api('GET', '/admin/overview', { token: adminToken });
  check('ADMIN allowed on admin route (200)', adminOverview.status === 200, `got ${adminOverview.status}`);
  check('admin overview returns user totals', typeof adminOverview.body?.data?.users?.total === 'number');
  await prisma.user.update({ where: { id: stored.id }, data: { role: 'STUDENT' } });

  group('CRUD round-trip (assignments)');
  const subject = await api('POST', '/subjects', { token: accessToken, body: { name: `Live Subject ${RUN}`, color: '#8b5cf6' } });
  const subjectId = subject.body?.data?.id;
  check('subject created', subject.status === 201 && Boolean(subjectId));
  const created = await api('POST', '/assignments', { token: accessToken, body: { title: 'Live assignment', subjectId, priority: 'HIGH', estimatedMinutes: 60 } });
  const assignmentId = created.body?.data?.id;
  check('assignment created with subject', created.status === 201 && created.body?.data?.subject?.id === subjectId);
  const list = await api('GET', '/assignments?limit=10', { token: accessToken });
  check('assignment appears in list', list.body?.data?.some((a) => a.id === assignmentId));
  check('list includes pagination', typeof list.body?.pagination?.total === 'number');
  const patched = await api('PATCH', `/assignments/${assignmentId}`, { token: accessToken, body: { status: 'COMPLETED' } });
  check('assignment completes (status + completedAt)', patched.body?.data?.status === 'COMPLETED' && Boolean(patched.body?.data?.completedAt));
  await api('DELETE', `/assignments/${assignmentId}`, { token: accessToken });
  check('delete is a soft delete', (await prisma.assignment.findUnique({ where: { id: assignmentId } }))?.deletedAt !== null);

  group('session management');
  const sessions = await api('GET', '/auth/sessions', { token: accessToken });
  check('sessions listed', Array.isArray(sessions.body?.data));
  check('current session flagged', sessions.body?.data?.some((s) => s.current === true));
  await api('POST', '/auth/logout', { token: accessToken });
  check('token rejected after logout', (await api('GET', '/auth/me', { token: accessToken })).status === 401);
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, OTHER] } } });
}

try {
  await run();
} catch (e) {
  failed++;
  console.error(`\nUNCAUGHT in "${section}":`, e?.message ?? e);
} finally {
  await cleanup().catch((e) => console.error('cleanup failed:', e?.message));
  await prisma.$disconnect();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
