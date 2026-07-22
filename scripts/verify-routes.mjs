/**
 * Verifies the mounted API route surface without needing a database.
 *
 * Auth gating and request validation both run before any query, so this
 * exercises the real Express app and asserts that every endpoint is mounted,
 * guarded, and returns the documented error envelope.
 *
 *   node scripts/verify-routes.mjs
 *
 * Requires `npm run build --workspace=backend` to have run first.
 */
import { createApp } from '../backend/dist/app.js';

const PORT = 4098;
const base = `http://127.0.0.1:${PORT}/api/v1`;
const server = createApp().listen(PORT);

/** [method, path, body, expectedStatus, label, extraHeaders?] */
const cases = [
  // --- Auth ---------------------------------------------------------------
  ['GET', '/auth/me', null, 401, 'me requires auth'],
  ['GET', '/auth/sessions', null, 401, 'sessions require auth'],
  ['POST', '/auth/register', { email: 'nope', username: 'a', name: '', password: 'short' }, 422, 'register rejects bad input'],
  ['POST', '/auth/login', { email: 'not-an-email', password: 'x' }, 422, 'login rejects bad email'],
  ['POST', '/auth/reset-password', { token: 't', password: 'weak' }, 422, 'reset enforces password policy'],
  ['POST', '/auth/refresh', {}, 401, 'refresh without token rejected'],
  ['GET', '/auth/oauth/providers', null, 200, 'oauth providers listed'],
  ['GET', '/auth/oauth/notaprovider', null, 422, 'unknown oauth provider rejected'],
  ['GET', '/assignments', null, 401, 'garbage bearer rejected', { Authorization: 'Bearer not.a.jwt' }],

  // --- Assignments / subjects / dashboard ---------------------------------
  ['GET', '/assignments', null, 401, 'assignments require auth'],
  ['GET', '/assignments/stats', null, 401, 'assignment stats require auth'],
  ['GET', '/subjects', null, 401, 'subjects require auth'],
  ['GET', '/dashboard/overview', null, 401, 'dashboard requires auth'],

  // --- Notes --------------------------------------------------------------
  ['GET', '/notes', null, 401, 'notes require auth'],
  ['GET', '/notes/tags', null, 401, 'note tags require auth'],
  ['POST', '/notes', { title: 'x' }, 401, 'create note requires auth'],
  ['PUT', '/notes/abc/autosave', { content: 'x' }, 401, 'autosave requires auth'],
  ['GET', '/notes/abc/versions', null, 401, 'versions require auth'],
  ['POST', '/notes/abc/summarise', {}, 401, 'note AI summarise requires auth'],
  ['GET', '/note-folders', null, 401, 'folders require auth'],

  // --- Flashcards ---------------------------------------------------------
  ['GET', '/decks', null, 401, 'decks require auth'],
  ['GET', '/decks/queue', null, 401, 'review queue requires auth'],
  ['GET', '/decks/stats', null, 401, 'card stats require auth'],
  ['POST', '/decks/cards/c1/review', { rating: 'good' }, 401, 'review requires auth'],
  ['POST', '/decks/abc/generate', { source: 'x' }, 401, 'card generation requires auth'],

  // --- Schedule / planner / focus / analytics -----------------------------
  ['GET', '/schedule/week', null, 401, 'week view requires auth'],
  ['POST', '/planner/generate', { days: 7 }, 401, 'plan generation requires auth'],
  ['GET', '/focus/active', null, 401, 'active session requires auth'],
  ['POST', '/focus/start', { type: 'POMODORO' }, 401, 'start session requires auth'],
  ['GET', '/analytics', null, 401, 'analytics require auth'],

  // --- AI suite -----------------------------------------------------------
  ['GET', '/ai/status', null, 401, 'ai status requires auth'],
  ['GET', '/ai/conversations', null, 401, 'conversations require auth'],
  ['POST', '/ai/chat', { content: 'hi' }, 401, 'chat requires auth'],
  ['POST', '/ai/chat/stream', { content: 'hi' }, 401, 'chat stream requires auth'],
  ['POST', '/ai/exam', { source: 'x'.repeat(30) }, 401, 'exam generation requires auth'],
  ['POST', '/ai/explain', { concept: 'entropy' }, 401, 'concept explainer requires auth'],
  ['POST', '/ai/learning-path', { goal: 'learn calculus' }, 401, 'learning path requires auth'],
  ['POST', '/ai/revision', { source: 'x'.repeat(30), topic: 't' }, 401, 'revision sheet requires auth'],
  ['POST', '/ai/coach', { situation: 'stressed about exams' }, 401, 'coach requires auth'],
  ['POST', '/ai/quiz', { source: 'x'.repeat(30) }, 401, 'quiz requires auth'],
  ['POST', '/ai/summarise', { source: 'x'.repeat(30) }, 401, 'summarise requires auth'],

  // --- Study groups -------------------------------------------------------
  ['GET', '/groups', null, 401, 'groups require auth'],
  ['GET', '/groups/discover', null, 401, 'group discovery requires auth'],
  ['POST', '/groups', { name: 'Study crew' }, 401, 'create group requires auth'],
  ['POST', '/groups/join', { inviteCode: 'abcd1234' }, 401, 'join requires auth'],
  ['GET', '/groups/g1', null, 401, 'group detail requires auth'],
  ['POST', '/groups/g1/channels', { name: 'general' }, 401, 'create channel requires auth'],
  ['GET', '/groups/g1/channels/c1/messages', null, 401, 'message history requires auth'],
  ['DELETE', '/groups/g1/messages/m1', null, 401, 'delete message requires auth'],
  ['PATCH', '/groups/g1/members/u1/role', { role: 'MODERATOR' }, 401, 'role change requires auth'],

  // --- Uploads ------------------------------------------------------------
  ['GET', '/uploads/status', null, 401, 'upload status requires auth'],
  ['POST', '/uploads/sign', { folder: 'avatars' }, 401, 'upload signing requires auth'],
  ['POST', '/uploads/register', { folder: 'notes' }, 401, 'upload register requires auth'],
  ['POST', '/uploads/avatar', { folder: 'avatars' }, 401, 'avatar upload requires auth'],

  // --- Admin --------------------------------------------------------------
  // Anonymous callers must be stopped by requireAuth before requireRole is
  // ever consulted, so these are 401 rather than 403.
  ['GET', '/admin/overview', null, 401, 'admin overview requires auth'],
  ['GET', '/admin/health', null, 401, 'admin health requires auth'],
  ['GET', '/admin/users', null, 401, 'admin user list requires auth'],
  ['GET', '/admin/users/u1', null, 401, 'admin user detail requires auth'],
  ['PATCH', '/admin/users/u1/role', { role: 'ADMIN' }, 401, 'role change requires auth'],
  ['POST', '/admin/users/u1/suspend', {}, 401, 'suspend requires auth'],
  ['POST', '/admin/users/u1/reinstate', null, 401, 'reinstate requires auth'],
  ['POST', '/admin/users/u1/revoke-sessions', null, 401, 'session revocation requires auth'],
  ['GET', '/admin/messages', null, 401, 'moderation queue requires auth'],
  ['DELETE', '/admin/messages/m1', {}, 401, 'message moderation requires auth'],
  ['GET', '/admin/groups', null, 401, 'admin group list requires auth'],
  ['GET', '/admin/logs', null, 401, 'audit log requires auth'],
];

let failures = 0;

for (const [method, path, body, expected, label, headers] of cases) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const ok = res.status === expected;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(36)} ${method} ${path} -> ${res.status} (want ${expected})`,
  );
}

// The public share link must sit outside the auth guard. It touches the
// database, so anything other than 401/404 proves it is mounted and public.
const shared = await fetch(`${base}/notes/shared/sometoken`);
const publicOk = shared.status !== 401 && shared.status !== 404;
if (!publicOk) failures += 1;
console.log(`${publicOk ? 'PASS' : 'FAIL'}  share link is public                 -> ${shared.status}`);

// Validation errors must name every offending field.
const detail = await (
  await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nope', username: 'a', name: '', password: 'short' }),
  })
).json();
const paths = [...new Set((detail.error?.details ?? []).map((d) => d.path))].sort();
const namesAll = ['email', 'name', 'password', 'username'].every((f) => paths.includes(f));
if (!namesAll) failures += 1;
console.log(`${namesAll ? 'PASS' : 'FAIL'}  validation names bad fields          -> [${paths.join(', ')}]`);

// Unmounted paths still 404.
const missing = await fetch(`${base}/no-such-module`);
const is404 = missing.status === 404;
if (!is404) failures += 1;
console.log(`${is404 ? 'PASS' : 'FAIL'}  unmounted path 404s                  -> ${missing.status}`);

server.close();

const total = cases.length + 3;
console.log(
  failures === 0
    ? `\nALL ${total} ROUTE CHECKS PASSED`
    : `\n${failures} of ${total} ROUTE CHECKS FAILED`,
);

// Give pino's worker thread a moment to flush before exiting.
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 100);
