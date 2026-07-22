# StudentOS AI

An AI-powered academic operating system — assignments, scheduling, notes,
spaced-repetition flashcards, focus sessions, analytics and study groups, with
every AI feature powered exclusively by the **Google Gemini API**.

> **Status: foundation complete, features in progress.** See
> [Current state](#current-state) for exactly what does and does not exist yet.

---

## Current state

**Working and verified:**

| Area | Status |
|---|---|
| npm workspace monorepo | ✅ |
| Prisma schema — 30 models, 14 enums | ✅ validates, client generates |
| Express app (helmet, CORS, compression, request IDs, structured logging) | ✅ boots, routes verified |
| Error handling (Zod + Prisma error mapping, JSON envelope) | ✅ |
| Auth: register, login, refresh rotation, logout, verify, reset, change password | ✅ 19 route checks pass |
| Two-factor auth (TOTP + QR enrolment) | ✅ live code generation/verification tested |
| OAuth (Google, GitHub, Discord) | ✅ state CSRF tested; **provider round-trip unverified** |
| Session management (list, revoke one, revoke others) | ✅ typechecked |
| RBAC middleware | ✅ typechecked |
| Rate limiting (global / auth / AI tiers, IPv6-safe) | ✅ verified at runtime |
| Assignments: CRUD, filter, search, sort, paginate, bulk, soft delete | ✅ typechecked, routes verified |
| Subjects + dashboard aggregation | ✅ typechecked, routes verified |
| Next.js frontend: landing, login, register, dashboard, assignments | ✅ builds, renders, calls the API |
| Frontend↔backend integration (CORS, refresh bootstrap) | ✅ verified in a browser |
| Notes: CRUD, folders, tags, search, favourites, archive, soft delete, version history, sharing | ✅ typechecked, routes verified |
| Markdown editor with debounced autosave + preview | ✅ builds, renders |
| Flashcards: decks, cards, SM-2 review queue, stats, heatmap, import/export | ✅ typechecked, routes verified |
| SM-2 spaced repetition algorithm | ✅ 24 tests against the published formula |
| Weekly timetable, conflict detection, recurrence expansion | ✅ 50 tests on the scheduling core |
| AI study planner (deterministic allocation + Gemini commentary) | ✅ typechecked, routes verified |
| Focus / Pomodoro sessions, streak + daily-stat rollup | ✅ typechecked, routes verified |
| Analytics: trends, weekday heatmap, GPA, weak subjects, burnout | ✅ typechecked, routes verified |
| AI suite: chat (+SSE streaming), homework helper, exam simulator, quiz, flashcards, summaries, concept explainer, coach, revision sheets, learning paths | ✅ typechecked, routes verified |
| Socket.io realtime: authenticated handshake, presence, typing, group chat | ✅ **9 live socket checks pass** |
| Study groups: groups, channels, members, roles, invites, message history | ✅ typechecked, routes verified |
| Cloudinary signed uploads (avatars, assignment/note/message attachments) | ✅ 18 tests on signature + policy |
| Docker, docker-compose, GitHub Actions CI | ✅ standalone build output verified |
| Admin dashboard: overview, user management, moderation, audit log, system health | ✅ typechecked, routes verified, RBAC tested |
| Study groups frontend + live Socket.io chat (presence, typing, delete) | ✅ builds, renders |
| Cloudinary upload UI (drag-drop, progress, avatars) | ✅ builds, renders |
| PWA: manifest, service worker, offline page, push handlers, icons | ✅ **verified live — SW activated, 20 assets cached** |
| Backend unit tests | ✅ 193/193 pass |
| Gemini service (text, JSON mode, streaming, retry/backoff) | ✅ typechecked, **not yet exercised against the live API** |

**Not yet built:** web-push subscription storage and the scheduled job that
sends reminders (the service worker's `push` and `notificationclick` handlers
are complete and tested; what remains is VAPID key handling and a server-side
sender).

Both workspaces compile clean under `tsc --strict`. The backend starts and
stops at the database connection until you supply a real `DATABASE_URL`.

### Verification commands

```bash
npm run verify              # build, then all three suites below
npm run verify:routes       # 57 route checks — no database needed
npm run verify:integration  # full user journeys against real Postgres
npm run verify:services     # real Gemini + Cloudinary calls (skips if unset)
npm run prisma:seed         # demo dataset: demo@studentos.ai / DemoPassword123
```

`verify:integration` creates a throwaway account, exercises registration,
login, refresh-token rotation and reuse detection, TOTP enrolment, CRUD across
every feature, cross-user isolation, and session revocation — then deletes
everything it created. `verify:services` makes genuine billable API calls and
skips cleanly when credentials are absent.

### Verified how

- `npm run test --workspace=backend` — 123 unit tests:
  - **Auth primitives (27)**: Argon2id round-trips, JWT cross-secret rejection,
    live TOTP generation/verification, OAuth state tampering, password policy.
  - **SM-2 (24)**: the 1/6/compound interval progression, the published ease
    formula per quality, the 1.3 ease floor, lapse resets, and a guard that no
    card can ever be scheduled into the past.
  - **Scheduling (50)**: overlap and merge rules, free-slot inversion, session
    packing (including that allocated sessions never overlap and never escape
    their slot), recurrence expansion, streak counting, burnout heuristics.
  - **Study content (22)**: markdown word counting and excerpting, plus CSV
    round-trips through commas, quotes and embedded newlines.
- A route harness exercising all 59 mounted endpoints for auth gating,
  validation, and error-envelope shape.
- The frontend was loaded in a real browser against the running API:
  CORS preflight, the anonymous `/auth/refresh` → 401 bootstrap, and
  `/auth/oauth/providers` → 200 were confirmed over the wire.

---

## Requirements

- **Node.js ≥ 20** (developed against v24)
- **npm** (this repo uses npm workspaces, not pnpm)
- A **PostgreSQL** database — a hosted instance such as
  [Neon](https://neon.tech) or [Supabase](https://supabase.com) is the fastest
  path and needs nothing installed locally
- A **Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey)
  (only required once AI routes exist)
- **Redis** — optional; without it the app runs single-instance with
  in-process caching

---

## Setup

```bash
# 1. Install dependencies (from the repo root)
npm install

# 2. Configure the backend
cp backend/.env.example backend/.env
```

Then edit `backend/.env` and set at minimum:

```ini
DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"
JWT_ACCESS_SECRET=<64-byte hex>
JWT_REFRESH_SECRET=<a different 64-byte hex>
GEMINI_API_KEY=<your key>
```

Generate the secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Configure the frontend too:

```bash
cp frontend/.env.example frontend/.env.local
```

```bash
# 3. Create the database tables
npm run prisma:generate
npm run prisma:push

# 4. Run both services (separate terminals)
npm run dev:backend    # http://localhost:4000
npm run dev:frontend   # http://localhost:3000
```

The API listens on `http://localhost:4000`. Verify it:

```bash
curl http://localhost:4000/health        # process is up
curl http://localhost:4000/health/ready  # database is reachable
curl http://localhost:4000/api/v1
```

---

## Architecture

```
backend/
  prisma/schema.prisma     Single source of truth for the data model
  src/
    config/                env (Zod-validated), prisma, redis, logger
    middlewares/           auth, validation, rate limiting, error handling
    routes/                Express routers, mounted under /api/v1
    services/              Business logic — gemini.service.ts lives here
    utils/                 errors, jwt, password, async handler
    types/                 Ambient type augmentation
```

**Module system:** the backend is native **ESM** (`"type": "module"`).
Relative imports therefore require explicit `.js` extensions — `./config/env.js`,
not `./config/env`. This is required because `@google/genai` ships as an ES
module and cannot be `require`d from CommonJS.

### The Gemini service

`backend/src/services/gemini.service.ts` is the **only** place a Gemini client
is constructed. Every AI feature routes through it, so retries, token
accounting, safety-block handling and model selection stay consistent.

```ts
import { geminiService } from './services/gemini.service.js';

// Free-form text
const { text, totalTokens } = await geminiService.generateFromPrompt(
  'Explain photosynthesis to a 14-year-old.',
);

// Structured output, validated before it reaches your code
const { data } = await geminiService.generateJson({
  messages: [{ role: 'user', content: notes }],
  responseSchema: { type: 'object', properties: { /* … */ } },
  parse: (value) => quizSchema.parse(value),
});

// Streaming, for the chat UI
for await (const chunk of geminiService.streamText({ messages })) {
  res.write(chunk);
}
```

It handles: exponential backoff on 429/5xx, safety-block detection (surfaced
as a 422 rather than a blank response), malformed-JSON recovery, abort signals,
and a 503 when `GEMINI_API_KEY` is unset — so AI routes degrade cleanly instead
of crashing.

---

## Security

- **Argon2id** password hashing at OWASP's recommended parameters
- **Refresh token rotation** with family-based reuse detection; tokens are
  stored SHA-256 hashed, so a database leak cannot be replayed
- **Server-side session validation** on every request, so logout and remote
  session revocation take effect immediately rather than at token expiry
- **Rate limiting** in three tiers, keyed per-account when authenticated so
  shared school networks don't throttle each other, and IPv6-normalised to a
  /64 so clients cannot evade limits by rotating addresses
- **Helmet**, strict CORS, and Zod validation on all input
- Secrets and tokens are redacted from logs

---

## Scripts

Run from the repo root:

| Command | Description |
|---|---|
| `npm run dev:backend` | Start the API with hot reload |
| `npm run build` | Compile all workspaces |
| `npm run typecheck` | Typecheck all workspaces |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run prisma:push` | Sync the schema to the database |
| `npm run prisma:studio` | Open Prisma Studio |

---

## Troubleshooting

**`Can't reach database server`** — `DATABASE_URL` is unset or wrong. Hosted
providers usually require `?sslmode=require`.

**`P1000: Authentication failed`** — the server was reached but the credentials
were rejected. The usual cause is an unescaped special character in the
password: a connection URL is percent-encoded, so a literal `%` must be written
`%25`, `@` as `%40`, `#` as `%23`, `/` as `%2F`, and `?` as `%3F`. Generate a
safe value with:

```bash
node -e "console.log(encodeURIComponent('your-password-here'))"
```

**Supabase specifically** — `db.<ref>.supabase.co` resolves to IPv6 only. If
your network or host has no IPv6 route, use the pooler instead, which is
dual-stack and is what Supabase now recommends for application connections:

```ini
DATABASE_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true"
```

**`Environment variable not found: DATABASE_URL`** when running `prisma`
commands directly — the Prisma CLI reads `backend/.env`, so run Prisma through
the npm scripts, or pass `--schema backend/prisma/schema.prisma` from the
backend directory.

**`ERR_MODULE_NOT_FOUND` on a relative import** — you omitted the `.js`
extension. ESM requires it, even in TypeScript source.

**Invalid environment configuration** on startup — `src/config/env.ts` validates
the environment with Zod and exits rather than starting half-configured. The
error names the offending variable.

**`@prisma/client has no exported member 'Role'`** — the generated client was
wiped, usually by deleting `node_modules`. Run `npm run prisma:generate`. The
backend's `postinstall` hook now does this automatically after every install.

**Dependency overrides not taking effect** — npm applies root `overrides` only
when it rebuilds the tree. Delete `node_modules` and `package-lock.json`, then
run a plain `npm install` (not `npm install --workspaces`, which scopes the
install and skips them).

### Known dependency risk

Next 15.5.x pins `postcss <8.5.10` and `sharp <0.35.0`, both of which carry
published advisories — `sharp`'s libvips CVEs are reachable through
`next/image`, so they matter once users upload avatars or attachments. The root
`package.json` overrides both to patched versions, and `npm audit` reports zero
vulnerabilities as a result. **Re-check these overrides on every Next upgrade**;
once Next ships versions that pin patched releases, the overrides can be
dropped.
