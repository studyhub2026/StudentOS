import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/server/env';
import { authService } from '@/server/services/auth.service';
import { oauthService, type ProviderKey } from '@/server/services/oauth.service';
import { setRefreshCookie } from '@/server/lib/cookies';
import { requestContext, route } from '@/server/lib/handler';
import { oauthProviderSchema } from '@/server/validators/auth.validator';

// Completes the OAuth flow and hands control back to the frontend. Tokens are
// never placed in the redirect URL — the refresh cookie is set instead.
export const GET = route<{ provider: string }>(async (req: NextRequest, { params }) => {
  const { provider } = oauthProviderSchema.parse(params);
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');

  if (!code || !state) {
    return NextResponse.redirect(`${env.APP_URL}/login?error=oauth_cancelled`);
  }

  try {
    const { redirectTo } = oauthService.verifyState(state, provider as ProviderKey);
    const accessToken = await oauthService.exchangeCode(provider as ProviderKey, code);
    const profile = await oauthService.fetchProfile(provider as ProviderKey, accessToken);

    const result = await authService.loginWithOAuth(
      provider as ProviderKey,
      profile,
      accessToken,
      requestContext(req),
    );

    const target = new URL('/auth/callback', env.APP_URL);
    if (redirectTo) target.searchParams.set('redirectTo', redirectTo);

    const res = NextResponse.redirect(target.toString());
    setRefreshCookie(res, result.tokens.refreshToken);
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sign-in failed';
    return NextResponse.redirect(`${env.APP_URL}/login?error=${encodeURIComponent(message)}`);
  }
});
