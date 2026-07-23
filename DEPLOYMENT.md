# Deploying StudentOS AI

The app is two independent services with **different hosting needs**:

| Service | Stack | Host |
|---|---|---|
| `frontend/` | Next.js 15 | **Vercel** |
| `backend/` | Express + Socket.io + Prisma | **Railway or Render** |

**The backend cannot run on Vercel.** Socket.io (group chat) needs persistent
WebSocket connections and the AI chat uses long-lived SSE streams; Vercel's
serverless functions are short-lived and stateless, so neither works there. The
backend is packaged as a Docker container (`backend/Dockerfile`) for a host that
runs a normal long-lived server.

Deploy the **backend first** — the frontend needs its URL at build time.

---

## 1. Database (Supabase)

Use the **Connection Pooler** URL (IPv4-compatible), not the direct
`db.<ref>.supabase.co` one (IPv6-only):

```
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true
```

Percent-encode any special character in the password: `%`→`%25`, `@`→`%40`,
`#`→`%23`, `/`→`%2F`, `?`→`%3F`. Generate a safe value with:

```bash
node -e "console.log(encodeURIComponent('your-password'))"
```

Apply the schema once from your machine (see the safety note at the end):

```bash
npm run prisma:push
npm run prisma:seed   # optional demo data
```

---

## 2. Backend → Railway or Render

Point the service at `backend/Dockerfile`. Set these environment variables:

```ini
NODE_ENV=production
PORT=4000
DATABASE_URL=<the pooler URL from step 1>
JWT_ACCESS_SECRET=<64-byte hex>
JWT_REFRESH_SECRET=<a different 64-byte hex>

# Cross-domain cookies: the frontend and API live on different domains, so the
# browser only sends the refresh cookie when it is SameSite=None.
COOKIE_SAMESITE=none
COOKIE_DOMAIN=

# Filled in after step 3 — the Vercel URL. Drives CORS and OAuth redirects.
APP_URL=https://<your-app>.vercel.app
API_URL=https://<your-service>.up.railway.app

# Optional integrations
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

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

After it deploys, confirm it is healthy:

```
GET https://<your-service>.up.railway.app/health/ready   → {"status":"ready","database":"up"}
```

---

## 3. Frontend → Vercel

In the Vercel dashboard, **Add New → Project** and import
`studyhub2026/StudentOS`, then:

1. **Root Directory** → set to `frontend`. This is the one setting that makes
   the monorepo work; Vercel then auto-detects Next.js.
2. **Environment Variables** → add:

   ```
   NEXT_PUBLIC_API_URL = https://<your-service>.up.railway.app
   ```

   This is inlined into the client bundle **at build time**, so it must be set
   before the first build. If it is missing, the app silently falls back to
   `http://localhost:4000` and every request fails for real visitors.
3. **Deploy.** Vercel builds `frontend/` and gives you
   `https://<your-app>.vercel.app`.

Then go back to the backend host and set `APP_URL` to that Vercel URL, and
redeploy the backend — the API's CORS allowlist and OAuth redirects read it.

---

## 4. OAuth redirect URIs (only if you use social login)

Register the callback URL with each provider, pointing at the **API**, not the
frontend:

```
https://<your-service>.up.railway.app/api/v1/auth/oauth/google/callback
https://<your-service>.up.railway.app/api/v1/auth/oauth/github/callback
https://<your-service>.up.railway.app/api/v1/auth/oauth/discord/callback
```

---

## 5. Verify the live deployment

- Open the Vercel URL, register an account, sign in.
- **Reload the page** — you should stay signed in. If you get logged out on
  reload, the cross-domain cookie is not being sent: recheck
  `COOKIE_SAMESITE=none` on the backend and that both services are on HTTPS.
- Open a study group and send a message in two tabs — it should appear live
  (confirms the WebSocket connection).

---

## Alternative: one domain (cleaner cookies)

If you own a domain, put both services on subdomains — `app.yourdomain.com`
(Vercel) and `api.yourdomain.com` (Railway/Render). Then set
`COOKIE_SAMESITE=lax` and `COOKIE_DOMAIN=.yourdomain.com`. Same-site cookies are
more robust than `SameSite=None`, which some browsers restrict.

---

## Safety note

`prisma db push` writes 31 tables. Run it only against a database you intend to
use for this app. Never commit a real `.env`; the repo ignores it, and
`*.env.example` holds templates only.
