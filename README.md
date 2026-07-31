# StudentOS AI

An AI-powered academic operating system — assignments, scheduling, notes,
spaced-repetition flashcards, focus sessions, analytics and study groups, with
every AI feature powered exclusively by the **Google Gemini API**.

It is a **single Next.js 15 application**: the UI, the `/api/v1` routes, and the
Prisma data layer all run in one process. Live group chat uses **Supabase
Realtime**, file uploads use **Cloudinary**, and all AI runs through **Gemini**.

---

## Features

| Area | Notes |
|---|---|
| Auth | register, login, refresh-token rotation with reuse detection, logout, email verify, password reset/change |
| Two-factor auth | TOTP with QR enrolment |
| OAuth | Google, GitHub, Discord (same-origin callbacks) |
| Sessions & RBAC | list/revoke sessions; role-gated admin area |
| Assignments | CRUD, filter, search, sort, paginate, bulk actions, soft delete, attachments |
| Subjects & dashboard | aggregated study stats and trends |
| Notes | CRUD, folders, tags, favourites, archive, version history, sharing, markdown editor with autosave, attachments |
| Flashcards | decks, SM-2 review queue, stats, heatmap, CSV import/export, AI generation |
| Schedule | weekly timetable, conflict detection, recurrence, AI study planner |
| Focus | Pomodoro sessions, streaks, daily-stat rollup |
| Analytics | trends, weekday heatmap, GPA, weak subjects, burnout heuristics |
| AI Assistant | threaded chat plus study tools: quiz, exam simulator, concept explainer, summariser, revision sheet, learning path, motivation coach |
| Study groups | groups, channels, members, roles, invites, message history, **live chat over Supabase Realtime** (presence + typing) |
| Uploads | Cloudinary signed uploads for avatars and note/assignment attachments |
| Admin | overview, user management, moderation, audit log, system health |
| PWA | manifest, offline support, install prompt, network-first navigation, content-hashed asset caching |

**192 unit tests** cover the pure logic (SM-2, scheduling, auth primitives,
upload signatures, AI prompts/schemas, markdown/CSV). The whole app compiles
clean under `tsc --strict`.

**Demo accounts** (after `npm run prisma:seed`):

- Student — `demo@studentos.ai` / `DemoPassword123`
- Admin — `admin@studentos.ai` / `AdminPassword123`

---

## Requirements

- **Node.js ≥ 20** (developed against v24)
- **npm** (this repo uses npm workspaces, not pnpm)
- A **PostgreSQL** database — a hosted instance such as
  [Supabase](https://supabase.com) or [Neon](https://neon.tech) is the fastest
  path and needs nothing installed locally
- Optional: a **Gemini API key** ([Google AI Studio](https://aistudio.google.com/apikey))
  for the AI features, **Cloudinary** credentials for uploads, and **Supabase**
  Realtime keys for live group chat. Each is optional — the app degrades
  gracefully when a service is unconfigured.

---

## Setup

```bash
# 1. Install dependencies (from the repo root)
npm install

# 2. Configure the app
cp frontend/.env.example frontend/.env
```

Then edit `frontend/.env` and set at minimum:

```ini
DATABASE_URL="postgresql://user:password@host:6543/dbname?pgbouncer=true"
DIRECT_URL="postgresql://user:password@host:5432/dbname"   # for migrations
JWT_ACCESS_SECRET=<64-byte hex>
JWT_REFRESH_SECRET=<a different 64-byte hex>

# Optional — enable the matching feature when present
GEMINI_API_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Generate the secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

```bash
# 3. Create the database tables and seed demo data
npm run prisma:generate
npm run prisma:push
npm run prisma:seed

# 4. Run the app
npm run dev            # http://localhost:3000
```

Other commands:

```bash
npm run typecheck      # tsc --noEmit
npm test               # vitest unit suite
npm run build          # production build
npm run prisma:studio  # browse the database
```

---

## Architecture

```
frontend/
  prisma/schema.prisma        Single source of truth for the data model
  public/                     Static assets, PWA manifest, service worker (sw.js)
  src/
    app/
      (app)/                  Authenticated pages (dashboard, ai, groups, …)
      (auth)/                 Login / register
      api/v1/                 Route handlers — the entire HTTP API
    server/
      db.ts                   The Prisma client singleton
      env.ts                  Zod-validated, server-only configuration
      lib/                    auth, jwt, password, cookies, errors, realtime
      services/               Business logic — gemini.service.ts lives here
      validators/             Zod request schemas
    components/ hooks/ stores/ lib/ types/   The client
```

Everything server-only imports `'server-only'` and lives under `src/server`, so
it never leaks into the client bundle. The API is same-origin, so the client
calls relative `/api/v1` paths — no `NEXT_PUBLIC_API_URL`, no CORS.

### The Gemini service

`src/server/services/gemini.service.ts` is the **only** place a Gemini client is
constructed. Every AI feature routes through it, so retries, token accounting,
safety-block handling and model selection stay consistent. It handles
exponential backoff on 429/5xx, safety-block detection, malformed-JSON recovery,
and a clear error when `GEMINI_API_KEY` is unset — so AI routes degrade cleanly
instead of crashing. Models are set via `GEMINI_DEFAULT_MODEL` /
`GEMINI_PRO_MODEL` (default: the `gemini-flash-latest` / `gemini-pro-latest`
aliases, which track the current stable model).

---

## Security

- **Argon2id** password hashing at OWASP's recommended parameters
- **Refresh token rotation** with family-based reuse detection; tokens are
  stored SHA-256 hashed, so a database leak cannot be replayed
- **Server-side session validation** on every request, so logout and remote
  session revocation take effect immediately rather than at token expiry
- **Rate limiting**, keyed per-account when authenticated so shared school
  networks don't throttle each other, and IPv6-normalised so clients cannot
  evade limits by rotating addresses
- Security headers, and Zod validation on all input
- Secrets and tokens are redacted from logs

---

## Deployment

The app deploys to **Vercel** (set the project root directory to `frontend`).
See [DEPLOYMENT.md](DEPLOYMENT.md) for the full walkthrough, including the
Supabase pooler URLs and the optional Docker/`docker-compose` self-hosting path.

---

## Troubleshooting

**`Can't reach database server`** — `DATABASE_URL` is unset or wrong. Hosted
providers usually require SSL and, on Supabase, the pooler host.

**`P1000: Authentication failed`** — the credentials were rejected. The usual
cause is an unescaped special character in the password: a connection URL is
percent-encoded, so a literal `%` must be written `%25`, `@` as `%40`, `#` as
`%23`, `/` as `%2F`, and `?` as `%3F`. Generate a safe value with:

```bash
node -e "console.log(encodeURIComponent('your-password-here'))"
```

**Supabase specifically** — `db.<ref>.supabase.co` resolves to IPv6 only. Use
the dual-stack pooler instead (transaction pooler on 6543 for `DATABASE_URL`,
session pooler on 5432 for `DIRECT_URL`).

**`Environment variable not found: DATABASE_URL`** when running `prisma`
directly — the Prisma CLI reads `frontend/.env`, so run Prisma through the npm
scripts (`npm run prisma:*`), which run in the `frontend` workspace.

**Invalid server environment** on startup — `src/server/env.ts` validates the
environment with Zod and throws rather than running half-configured. The error
names the offending variable.

**`@prisma/client has no exported member 'Role'`** — the generated client was
wiped, usually by deleting `node_modules`. Run `npm run prisma:generate` (the
`postinstall` hook also does this automatically).

### Known dependency risk

Next 15.5.x pins `postcss <8.5.10` and `sharp <0.35.0`, both of which carry
published advisories — `sharp`'s libvips CVEs are reachable through
`next/image`, so they matter once users upload avatars or attachments. The root
`package.json` overrides both to patched versions, and `npm audit` reports zero
vulnerabilities as a result. **Re-check these overrides on every Next upgrade.**
