import 'server-only';
import type { NextResponse } from 'next/server';
import { env } from '@/server/env';

export const REFRESH_COOKIE_NAME = 'sos_refresh';

/**
 * The refresh token lives in an httpOnly cookie so page scripts cannot read it,
 * which contains the damage from an XSS bug.
 *
 * Now that the app and API share an origin, the default `sameSite: lax` is
 * exactly right — no cross-site concessions are needed, unlike the previous
 * split Vercel/Railway deployment.
 */
function baseOptions() {
  const sameSite =
    env.COOKIE_SAMESITE === 'none' && !env.isProduction ? 'lax' : env.COOKIE_SAMESITE;

  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite,
    path: '/api/v1/auth',
    ...(env.isProduction && env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  } as const;
}

export function setRefreshCookie(res: NextResponse, token: string): void {
  res.cookies.set(REFRESH_COOKIE_NAME, token, {
    ...baseOptions(),
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: NextResponse): void {
  res.cookies.set(REFRESH_COOKIE_NAME, '', { ...baseOptions(), maxAge: 0 });
}
