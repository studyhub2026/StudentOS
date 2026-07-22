/**
 * End-to-end integration verification against a REAL database.
 *
 * Unlike verify-routes.mjs (which only proves routes are mounted and guarded),
 * this drives complete user journeys through real Postgres: registration,
 * login, JWT rotation, 2FA, and CRUD across every feature. It creates its own
 * throwaway account and deletes it afterwards, so it is safe to re-run and
 * never touches existing data.
 *
 *   npm run build --workspace=backend
 *   node scripts/verify-integration.mjs
 *
 * Exits non-zero on the first failed assertion group, so CI fails loudly.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../backend/dist/app.js';

const PORT = 4096;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

const prisma = new PrismaClient();
const server = createApp().listen(PORT);

// Unique per run so concurrent runs cannot collide.
const RUN = crypto.randomBytes(4).toString('hex');
const EMAIL = `verify-${RUN}@studentos.test`;
const USERNAME = `verify${RUN}`;
const PASSWORD = 'IntegrationPass123';

let passed = 0;
let failed = 0;
let section = '';

function group(name) {
  section = name;
  console.log(`\n--- ${name} ---`);
}

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
}

/** Cookie jar, so refresh-token rotation behaves as it does in a browser. */
let cookieJar = '';

async function api(method, path, { body, token, expectStatus } = {}) {
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
  if (setCookie.length > 0) {
    cookieJar = setCookie.map((entry) => entry.split(';')[0]).join('; ');
  }

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }

  if (expectStatus !== undefined && res.status !== expectStatus) {
    console.log(`      [${section}] ${method} ${path} -> ${res.status}, wanted ${expectStatus}`);
    console.log(`      body: ${JSON.stringify(json).slice(0, 300)}`);
  }

  return { status: res.status, body: json };
}

async function run() {
  // --- Connectivity -------------------------------------------------------
  group('database connectivity');
  await prisma.$queryRaw`SELECT 1`;
  check('database accepts queries', true);

  const tables = await prisma.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  const tableNames = tables.map((row) => row.table_name).sort();
  check(`schema has 31 tables (found ${tableNames.length})`, tableNames.length === 31, tableNames.join(', '));

  for (const expected of ['users', 'assignments', 'notes', 'flashcards', 'study_groups', 'ai_conversations']) {
    check(`  table "${expected}" exists`, tableNames.includes(expected));
  }

  // --- Registration -------------------------------------------------------
  group('registration');
  const registered = await api('POST', '/auth/register', {
    body: { email: EMAIL, username: USERNAME, name: 'Verify Runner', password: PASSWORD },
    expectStatus: 201,
  });
  check('registration returns 201', registered.status === 201);
  check('registration returns an access token', Boolean(registered.body?.data?.accessToken));
  check('registration sets a refresh cookie', cookieJar.includes('sos_refresh'));
  check('password is not echoed back', !JSON.stringify(registered.body).includes(PASSWORD));

  const userId = registered.body?.data?.user?.id;
  let accessToken = registered.body?.data?.accessToken;

  const stored = await prisma.user.findUnique({ where: { email: EMAIL } });
  check('user row was created', Boolean(stored));
  check('password is hashed with argon2id', stored?.passwordHash?.startsWith('$argon2id$') === true);
  check('default settings row was created', Boolean(await prisma.userSettings.findUnique({ where: { userId } })));

  const duplicate = await api('POST', '/auth/register', {
    body: { email: EMAIL, username: `${USERNAME}b`, name: 'Dup', password: PASSWORD },
  });
  check('duplicate email is rejected with 409', duplicate.status === 409);

  // --- Login --------------------------------------------------------------
  group('login');
  cookieJar = '';
  const login = await api('POST', '/auth/login', {
    body: { email: EMAIL, password: PASSWORD },
    expectStatus: 200,
  });
  check('login succeeds', login.status === 200);
  accessToken = login.body?.data?.accessToken;
  check('login returns an access token', Boolean(accessToken));

  const wrongPassword = await api('POST', '/auth/login', {
    body: { email: EMAIL, password: 'WrongPassword123' },
  });
  check('wrong password is rejected', wrongPassword.status === 401);

  const unknownEmail = await api('POST', '/auth/login', {
    body: { email: `nobody-${RUN}@studentos.test`, password: PASSWORD },
  });
  check('unknown email returns the same 401', unknownEmail.status === 401);
  check(
    'unknown email and wrong password are indistinguishable',
    JSON.stringify(unknownEmail.body) === JSON.stringify(wrongPassword.body),
  );

  // --- Authenticated identity ---------------------------------------------
  group('authenticated identity');
  const me = await api('GET', '/auth/me', { token: accessToken, expectStatus: 200 });
  check('/auth/me returns the current user', me.body?.data?.email === EMAIL);
  check('/auth/me never exposes the password hash', !JSON.stringify(me.body).includes('argon2'));

  const noToken = await api('GET', '/auth/me');
  check('/auth/me without a token is 401', noToken.status === 401);

  // --- Refresh token rotation ---------------------------------------------
  group('refresh token rotation');
  const firstCookie = cookieJar;
  const refreshed = await api('POST', '/auth/refresh', { body: {}, expectStatus: 200 });
  check('refresh returns a new access token', Boolean(refreshed.body?.data?.accessToken));
  check('refresh rotates the cookie', cookieJar !== firstCookie);

  const rotatedToken = refreshed.body?.data?.accessToken;
  check('the rotated access token works', (await api('GET', '/auth/me', { token: rotatedToken })).status === 200);

  // Replaying the superseded refresh token must revoke the whole family.
  const savedJar = cookieJar;
  cookieJar = firstCookie;
  const replay = await api('POST', '/auth/refresh', { body: {} });
  check('replaying an old refresh token is rejected', replay.status === 401);

  cookieJar = savedJar;
  const afterReuse = await api('POST', '/auth/refresh', { body: {} });
  check('reuse detection revokes the entire token family', afterReuse.status === 401, `got ${afterReuse.status}`);

  const familyRows = await prisma.refreshToken.findMany({ where: { userId }, select: { revokedAt: true } });
  check('every refresh token in the family is revoked', familyRows.every((row) => row.revokedAt !== null));

  // Re-login for the remainder of the run.
  cookieJar = '';
  const relogin = await api('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  accessToken = relogin.body?.data?.accessToken;
  check('re-login after family revocation succeeds', relogin.status === 200);

  // --- Two-factor ---------------------------------------------------------
  group('two-factor authentication');
  const setup = await api('POST', '/auth/2fa/setup', { token: accessToken, expectStatus: 200 });
  const secret = setup.body?.data?.secret;
  check('2FA setup returns a secret', Boolean(secret));
  check('2FA setup returns a scannable QR', setup.body?.data?.qrCode?.startsWith('data:image/png;base64,') === true);

  const totp = new OTPAuth.TOTP({
    issuer: 'StudentOS AI',
    label: EMAIL,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  const badEnable = await api('POST', '/auth/2fa/enable', {
    token: accessToken,
    body: { secret, totp: '000000' },
  });
  check('2FA rejects an incorrect enrolment code', badEnable.status === 400);

  const enable = await api('POST', '/auth/2fa/enable', {
    token: accessToken,
    body: { secret, totp: totp.generate() },
    expectStatus: 200,
  });
  check('2FA enables with a valid code', enable.status === 200);

  cookieJar = '';
  const loginWithout2fa = await api('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  check('login now demands a 2FA code', loginWithout2fa.status === 400);

  const loginWith2fa = await api('POST', '/auth/login', {
    body: { email: EMAIL, password: PASSWORD, totp: totp.generate() },
    expectStatus: 200,
  });
  check('login succeeds with a valid 2FA code', loginWith2fa.status === 200);
  accessToken = loginWith2fa.body?.data?.accessToken;

  await api('POST', '/auth/2fa/disable', {
    token: accessToken,
    body: { password: PASSWORD, totp: totp.generate() },
  });
  check('2FA can be disabled', (await prisma.user.findUnique({ where: { id: userId } }))?.twoFactorEnabled === false);

  // --- Subjects and assignments -------------------------------------------
  group('subjects and assignments CRUD');
  const subject = await api('POST', '/subjects', {
    token: accessToken,
    body: { name: 'Integration Chemistry', color: '#8b5cf6', credits: 4 },
    expectStatus: 201,
  });
  const subjectId = subject.body?.data?.id;
  check('subject created', subject.status === 201 && Boolean(subjectId));

  const dupSubject = await api('POST', '/subjects', {
    token: accessToken,
    body: { name: 'Integration Chemistry', color: '#8b5cf6' },
  });
  check('duplicate subject name is rejected', dupSubject.status === 409);

  const created = await api('POST', '/assignments', {
    token: accessToken,
    body: {
      title: 'Integration assignment',
      subjectId,
      priority: 'HIGH',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      estimatedMinutes: 90,
      labels: ['verify'],
    },
    expectStatus: 201,
  });
  const assignmentId = created.body?.data?.id;
  check('assignment created', created.status === 201);
  check('assignment includes its subject', created.body?.data?.subject?.id === subjectId);

  const listed = await api('GET', '/assignments?limit=10', { token: accessToken, expectStatus: 200 });
  check('assignment list returns the new row', listed.body?.data?.some((a) => a.id === assignmentId));
  check('list response includes pagination', typeof listed.body?.pagination?.total === 'number');

  const searched = await api('GET', '/assignments?search=Integration', { token: accessToken });
  check('search matches by title', searched.body?.data?.length >= 1);

  const filtered = await api('GET', '/assignments?priority=HIGH', { token: accessToken });
  check('priority filter works', filtered.body?.data?.every((a) => a.priority === 'HIGH'));

  const patched = await api('PATCH', `/assignments/${assignmentId}`, {
    token: accessToken,
    body: { status: 'COMPLETED' },
    expectStatus: 200,
  });
  check('assignment status updates', patched.body?.data?.status === 'COMPLETED');
  check('completing sets completedAt', Boolean(patched.body?.data?.completedAt));
  check('completing sets progress to 100', patched.body?.data?.progress === 100);

  const stats = await api('GET', '/assignments/stats', { token: accessToken, expectStatus: 200 });
  check('stats count the completed assignment', stats.body?.data?.completed >= 1);

  await api('DELETE', `/assignments/${assignmentId}`, { token: accessToken, expectStatus: 200 });
  const softDeleted = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  check('delete is a soft delete', softDeleted?.deletedAt !== null);

  // --- Notes --------------------------------------------------------------
  group('notes CRUD and version history');
  const note = await api('POST', '/notes', {
    token: accessToken,
    body: { title: 'Integration note', content: '# Heading\n\nSome **content** here.', tags: ['verify'] },
    expectStatus: 201,
  });
  const noteId = note.body?.data?.id;
  check('note created', note.status === 201);
  check('word count computed server-side', note.body?.data?.wordCount > 0);
  check('excerpt strips markdown', !note.body?.data?.excerpt?.includes('**'));

  await api('PATCH', `/notes/${noteId}`, {
    token: accessToken,
    body: { content: '# Heading\n\nRevised content, materially different.' },
    expectStatus: 200,
  });
  const versions = await api('GET', `/notes/${noteId}/versions`, { token: accessToken });
  check('editing creates a version snapshot', versions.body?.data?.length === 1);

  await api('PATCH', `/notes/${noteId}`, { token: accessToken, body: { title: 'Renamed only' } });
  const versionsAfterTitle = await api('GET', `/notes/${noteId}/versions`, { token: accessToken });
  check('a title-only edit does not create a version', versionsAfterTitle.body?.data?.length === 1);

  const versionId = versions.body?.data?.[0]?.id;
  const restored = await api('POST', `/notes/${noteId}/versions/${versionId}/restore`, {
    token: accessToken,
    expectStatus: 200,
  });
  check('a version can be restored', restored.body?.data?.content?.includes('Some **content** here'));

  await api('PATCH', `/notes/${noteId}/favorite`, { token: accessToken, body: { favorite: true } });
  const favourites = await api('GET', '/notes?view=favorites', { token: accessToken });
  check('favourites view filters correctly', favourites.body?.data?.some((n) => n.id === noteId));

  // --- Flashcards and SM-2 ------------------------------------------------
  group('flashcards and SM-2 scheduling');
  const deck = await api('POST', '/decks', {
    token: accessToken,
    body: { name: 'Integration deck', color: '#14b8a6' },
    expectStatus: 201,
  });
  const deckId = deck.body?.data?.id;
  check('deck created', deck.status === 201);

  const card = await api('POST', `/decks/${deckId}/cards`, {
    token: accessToken,
    body: { front: 'What is 2 + 2?', back: 'Four.', difficulty: 'EASY' },
    expectStatus: 201,
  });
  const cardId = card.body?.data?.id;
  check('card created in NEW state', card.body?.data?.state === 'NEW');
  check('new card is due immediately', new Date(card.body?.data?.dueAt) <= new Date());

  const queue = await api('GET', `/decks/queue?deckId=${deckId}`, { token: accessToken, expectStatus: 200 });
  check('review queue includes the new card', queue.body?.data?.some((c) => c.id === cardId));
  check('queue provides interval previews', typeof queue.body?.data?.[0]?.intervalPreview?.good === 'number');

  const review = await api('POST', `/decks/cards/${cardId}/review`, {
    token: accessToken,
    body: { rating: 'good', responseMs: 3000 },
    expectStatus: 200,
  });
  check('review is accepted', review.status === 200);
  check('first successful review schedules 1 day out', review.body?.data?.intervalDays === 1);

  const afterReview = await prisma.flashcard.findUnique({ where: { id: cardId } });
  check('card scheduling state persisted', afterReview?.repetitions === 1);
  check('review history row written', (await prisma.flashcardReview.count({ where: { cardId } })) === 1);

  const again = await api('POST', `/decks/cards/${cardId}/review`, {
    token: accessToken,
    body: { rating: 'again' },
  });
  check('a failed review resets repetitions', again.body?.data?.passed === false);
  check('lapse recorded', (await prisma.flashcard.findUnique({ where: { id: cardId } }))?.lapses === 1);

  // --- Ownership isolation ------------------------------------------------
  group('ownership isolation');
  const otherEmail = `other-${RUN}@studentos.test`;
  cookieJar = '';
  const other = await api('POST', '/auth/register', {
    body: { email: otherEmail, username: `other${RUN}`, name: 'Other User', password: PASSWORD },
  });
  const otherToken = other.body?.data?.accessToken;

  check('another user cannot read the note', (await api('GET', `/notes/${noteId}`, { token: otherToken })).status === 404);
  check('another user cannot read the deck', (await api('GET', `/decks/${deckId}`, { token: otherToken })).status === 404);
  check(
    'another user cannot delete the note',
    (await api('DELETE', `/notes/${noteId}`, { token: otherToken })).status === 404,
  );

  // --- Study groups -------------------------------------------------------
  group('study groups');
  const group1 = await api('POST', '/groups', {
    token: accessToken,
    body: { name: `Verify Group ${RUN}`, isPublic: true },
    expectStatus: 201,
  });
  const groupId = group1.body?.data?.id;
  const inviteCode = group1.body?.data?.inviteCode;
  check('group created with a default channel', group1.body?.data?.channels?.length === 1);
  check('group created with an invite code', Boolean(inviteCode));

  const joined = await api('POST', '/groups/join', { token: otherToken, body: { inviteCode }, expectStatus: 201 });
  check('a second user can join by invite', joined.status === 201);

  const rejoin = await api('POST', '/groups/join', { token: otherToken, body: { inviteCode } });
  check('joining twice is rejected', rejoin.status === 409);

  const detail = await api('GET', `/groups/${groupId}`, { token: accessToken });
  check('group shows both members', detail.body?.data?.members?.length === 2);

  const leaveAsOwner = await api('POST', `/groups/${groupId}/leave`, { token: accessToken });
  check('the owner cannot simply leave', leaveAsOwner.status === 400);

  // --- Dashboard and analytics --------------------------------------------
  group('dashboard and analytics');
  const overview = await api('GET', '/dashboard/overview', { token: accessToken, expectStatus: 200 });
  check('dashboard overview responds', overview.status === 200);
  check('dashboard reports assignment stats', typeof overview.body?.data?.assignments?.total === 'number');
  check('dashboard trend is gap-filled', overview.body?.data?.trend?.length === 14);

  const analytics = await api('GET', '/analytics?days=30', { token: accessToken, expectStatus: 200 });
  check('analytics responds', analytics.status === 200);
  check('analytics returns 30 daily points', analytics.body?.data?.daily?.length === 30);

  // --- Session management -------------------------------------------------
  group('session management');
  const sessions = await api('GET', '/auth/sessions', { token: accessToken, expectStatus: 200 });
  check('sessions are listed', Array.isArray(sessions.body?.data));
  check('the current session is flagged', sessions.body?.data?.some((s) => s.current === true));

  await api('POST', '/auth/logout', { token: accessToken, expectStatus: 200 });
  check('the access token is rejected after logout', (await api('GET', '/auth/me', { token: accessToken })).status === 401);
}

async function cleanup() {
  // Remove every account this run created, cascading all owned rows.
  await prisma.user.deleteMany({
    where: { email: { in: [EMAIL, `other-${RUN}@studentos.test`] } },
  });
}

/** Prisma errors often carry the detail on `code`/`meta` rather than message. */
function describe(error) {
  if (!error) return 'unknown error';
  const parts = [
    error.code ? `[${error.code}]` : '',
    error.message?.trim(),
    error.meta ? JSON.stringify(error.meta) : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : String(error);
}

try {
  await run();
} catch (error) {
  failed += 1;
  console.error(`\nUNCAUGHT ERROR in "${section}": ${describe(error)}`);

  // Prisma wraps connection failures, so the code is not always on the
  // outermost error — match the message text as well.
  const blob = `${error?.code ?? ''} ${error?.message ?? ''}`;
  const connectionProblem =
    /P100[01]|Can't reach database server|Authentication failed|ECONNREFUSED|ETIMEDOUT/i.test(blob);

  if (connectionProblem) {
    console.error(
      '\nThe database is unreachable or rejected the credentials. Check DATABASE_URL\n' +
        'in backend/.env — remember that a literal % in the password must be written\n' +
        '%25, @ as %40, # as %23, / as %2F and ? as %3F.',
    );
  }
} finally {
  await cleanup().catch((error) => console.error('cleanup failed:', describe(error)));
  await prisma.$disconnect();
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 150);
