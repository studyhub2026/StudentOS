# Deploying StudentOS AI

The app is a **single Next.js service** — the UI, the API routes, and Prisma
all run in one process — so it deploys like any Next.js app. **Vercel** is the
default target.

Live group chat runs over **Supabase Realtime** (the browser talks to Supabase
directly, not through a long-lived socket on our server), so there is no
WebSocket server to host and nothing that Vercel's serverless model can't run.

---

## 1. Database (Supabase)

Use the **Connection Pooler** URL (IPv4-compatible), not the direct
`db.<ref>.supabase.co` one (IPv6-only):

```
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true
```

The transaction pooler (port 6543) cannot run migrations, so also set a
`DIRECT_URL` to the **session** pooler (same host, port 5432) — Prisma uses it
for `db push` while the app uses the transaction pooler at runtime.

Percent-encode any special character in the password: `%`→`%25`, `@`→`%40`,
`#`→`%23`, `/`→`%2F`, `?`→`%3F`. Generate a safe value with:

```bash
node -e "console.log(encodeURIComponent('your-password'))"
```

Apply the schema once from your machine (see the safety note at the end):

```bash
npm run prisma:push
npm run prisma:seed   # optional demo data (creates the demo + admin accounts)
```

---

## 2. Deploy to Vercel

In the Vercel dashboard, **Add New → Project** and import
`studyhub2026/StudentOS`, then:

1. **Root Directory** → set to `frontend`. This is the one setting that makes
   the monorepo work; Vercel then auto-detects Next.js.
2. **Environment Variables** → add:

   ```ini
   DATABASE_URL=<the transaction-pooler URL from step 1>
   DIRECT_URL=<the session-pooler URL from step 1>

   JWT_ACCESS_SECRET=<64-byte hex>
   JWT_REFRESH_SECRET=<a different 64-byte hex>

   APP_URL=https://<your-app>.vercel.app   # own URL, for OAuth + email links

   # Live group chat (Supabase Realtime)
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service role key>
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon/publishable key>

   # Optional integrations — leave unset to run without them
   GEMINI_API_KEY=
   CLOUDINARY_CLOUD_NAME=
   CLOUDINARY_API_KEY=
   CLOUDINARY_API_SECRET=
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   GITHUB_CLIENT_ID=
   GITHUB_CLIENT_SECRET=
   DISCORD_CLIENT_ID=
   DISCORD_CLIENT_SECRET=
   ```

   The API is same-origin, so there is no `NEXT_PUBLIC_API_URL` to set and no
   CORS to configure. The refresh cookie is first-party, so `COOKIE_SAMESITE`
   stays on its `lax` default.

3. **Deploy.** Vercel builds `frontend/` and gives you
   `https://<your-app>.vercel.app`.

Generate a JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Self-hosting with Docker (optional)

`frontend/Dockerfile` produces a standalone image, and `docker-compose.yml`
brings up Postgres plus the app for a local production-like stack.

---

## 3. OAuth redirect URIs (only if you use social login)

Register the callback URL with each provider, pointing at your deployment
(the API is same-origin):

```
https://<your-app>.vercel.app/api/v1/auth/oauth/google/callback
https://<your-app>.vercel.app/api/v1/auth/oauth/github/callback
https://<your-app>.vercel.app/api/v1/auth/oauth/discord/callback
```

---

## 4. Verify the live deployment

- Open the Vercel URL, register an account, sign in.
- **Reload the page** — you should stay signed in.
- Open a study group and send a message in two tabs — it should appear live
  (confirms Supabase Realtime).
- Open the AI Assistant and send a message (needs `GEMINI_API_KEY`).

---

## Safety note

`prisma db push` writes 31 tables. Run it only against a database you intend to
use for this app. Never commit a real `.env`; the repo ignores it, and
`*.env.example` holds templates only.
