import type { CookieOptions, Response } from 'express';
import { env } from '../config/env.js';

export const REFRESH_COOKIE_NAME = 'sos_refresh';

/**
 * The refresh token lives in an httpOnly cookie so page scripts cannot read
 * it, which contains the damage from an XSS bug.
 *
 * `sameSite` and `domain` are configurable because the right values depend on
 * how the app is deployed:
 *   - Same origin (or frontend and API on subdomains of one domain): the
 *     default `lax` with `COOKIE_DOMAIN=.yourdomain.com`.
 *   - Split across different domains (Vercel frontend + Railway/Render API):
 *     `COOKIE_SAMESITE=none` and an empty `COOKIE_DOMAIN`, so the browser sends
 *     the cookie on cross-site fetches. `none` requires Secure, which is on in
 *     production.
 */
function baseOptions(): CookieOptions {
  // A `none` cookie without Secure is rejected by browsers, so downgrade to
  // `lax` when not on HTTPS (i.e. local development).
  const sameSite =
    env.COOKIE_SAMESITE === 'none' && !env.isProduction ? 'lax' : env.COOKIE_SAMESITE;

  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite,
    path: '/api/v1/auth',
    // Only pin a domain when one is configured; otherwise the cookie is
    // host-only on the API's domain, which is correct for a split deployment.
    ...(env.isProduction && env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseOptions(),
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, baseOptions());
}
