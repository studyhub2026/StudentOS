import 'server-only';
import crypto from 'node:crypto';
import { OAuthProvider } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { env } from '@/server/env';
import { logger } from '@/server/lib/logger';
import { AppError, BadRequestError } from '@/server/lib/errors';

/**
 * OAuth 2.0 authorization-code flow for Google, GitHub and Discord.
 *
 * Implemented with plain `fetch` rather than a provider SDK — the flow is
 * three requests and avoiding three heavyweight dependencies keeps the
 * behaviour explicit and auditable.
 */

export type ProviderKey = 'google' | 'github' | 'discord';

export interface OAuthProfile {
  providerAccountId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  enum: OAuthProvider;
  fetchProfile: (accessToken: string) => Promise<OAuthProfile>;
}

const STATE_TTL_SECONDS = 600;

function redirectUri(provider: ProviderKey): string {
  return `${env.APP_URL}/api/v1/auth/oauth/${provider}/callback`;
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  context: string,
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error({ status: response.status, context, body: body.slice(0, 300) }, 'oauth request failed');
    throw new AppError(`OAuth ${context} failed`, 502, 'OAUTH_PROVIDER_ERROR');
  }
  return (await response.json()) as T;
}

// --- Provider profile fetchers ---------------------------------------------

async function fetchGoogleProfile(accessToken: string): Promise<OAuthProfile> {
  const data = await requestJson<{
    sub: string;
    email: string;
    email_verified: boolean;
    name?: string;
    picture?: string;
  }>(
    'https://www.googleapis.com/oauth2/v3/userinfo',
    { headers: { Authorization: `Bearer ${accessToken}` } },
    'google profile',
  );

  return {
    providerAccountId: data.sub,
    email: data.email.toLowerCase(),
    name: data.name ?? data.email.split('@')[0] ?? 'Student',
    avatarUrl: data.picture ?? null,
    emailVerified: Boolean(data.email_verified),
  };
}

async function fetchGitHubProfile(accessToken: string): Promise<OAuthProfile> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'StudentOS-AI',
  };

  const user = await requestJson<{
    id: number;
    login: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  }>('https://api.github.com/user', { headers }, 'github profile');

  let email = user.email;
  let emailVerified = false;

  // GitHub omits the email from /user when it is set to private, so the
  // dedicated endpoint is the only reliable source.
  if (!email) {
    const emails = await requestJson<
      { email: string; primary: boolean; verified: boolean }[]
    >('https://api.github.com/user/emails', { headers }, 'github emails');

    const primary = emails.find((entry) => entry.primary) ?? emails[0];
    if (!primary) {
      throw new BadRequestError(
        'Your GitHub account has no accessible email address. Add one, or sign up with email instead.',
      );
    }
    email = primary.email;
    emailVerified = primary.verified;
  }

  return {
    providerAccountId: String(user.id),
    email: email.toLowerCase(),
    name: user.name ?? user.login,
    avatarUrl: user.avatar_url,
    emailVerified,
  };
}

async function fetchDiscordProfile(accessToken: string): Promise<OAuthProfile> {
  const data = await requestJson<{
    id: string;
    username: string;
    global_name: string | null;
    email: string | null;
    verified?: boolean;
    avatar: string | null;
  }>(
    'https://discord.com/api/v10/users/@me',
    { headers: { Authorization: `Bearer ${accessToken}` } },
    'discord profile',
  );

  if (!data.email) {
    throw new BadRequestError(
      'Your Discord account has no email address attached. Add one, or sign up with email instead.',
    );
  }

  return {
    providerAccountId: data.id,
    email: data.email.toLowerCase(),
    name: data.global_name ?? data.username,
    avatarUrl: data.avatar
      ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png`
      : null,
    emailVerified: Boolean(data.verified),
  };
}

// --- Registry ---------------------------------------------------------------

const providers: Record<ProviderKey, ProviderConfig> = {
  google: {
    clientId: env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    enum: OAuthProvider.GOOGLE,
    fetchProfile: fetchGoogleProfile,
  },
  github: {
    clientId: env.GITHUB_CLIENT_ID ?? '',
    clientSecret: env.GITHUB_CLIENT_SECRET ?? '',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    enum: OAuthProvider.GITHUB,
    fetchProfile: fetchGitHubProfile,
  },
  discord: {
    clientId: env.DISCORD_CLIENT_ID ?? '',
    clientSecret: env.DISCORD_CLIENT_SECRET ?? '',
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scope: 'identify email',
    enum: OAuthProvider.DISCORD,
    fetchProfile: fetchDiscordProfile,
  },
};

export function isProviderConfigured(provider: ProviderKey): boolean {
  const config = providers[provider];
  return Boolean(config.clientId && config.clientSecret);
}

export function listConfiguredProviders(): ProviderKey[] {
  return (Object.keys(providers) as ProviderKey[]).filter(isProviderConfigured);
}

export function toProviderEnum(provider: ProviderKey): OAuthProvider {
  return providers[provider].enum;
}

function requireConfigured(provider: ProviderKey): ProviderConfig {
  const config = providers[provider];
  if (!config.clientId || !config.clientSecret) {
    throw new AppError(
      `${provider} sign-in is not configured on this server`,
      503,
      'OAUTH_NOT_CONFIGURED',
    );
  }
  return config;
}

// --- State (CSRF protection) ------------------------------------------------

/**
 * State is a short-lived signed JWT rather than a server-side record, so the
 * callback can be validated without shared storage across instances.
 */
export function createState(provider: ProviderKey, redirectTo?: string): string {
  return jwt.sign(
    { provider, nonce: crypto.randomBytes(16).toString('hex'), redirectTo },
    env.JWT_ACCESS_SECRET,
    { expiresIn: STATE_TTL_SECONDS, issuer: 'studentos-ai', audience: 'oauth-state' },
  );
}

export function verifyState(
  state: string,
  expectedProvider: ProviderKey,
): { redirectTo?: string } {
  let payload: { provider?: string; redirectTo?: string };
  try {
    payload = jwt.verify(state, env.JWT_ACCESS_SECRET, {
      issuer: 'studentos-ai',
      audience: 'oauth-state',
    }) as typeof payload;
  } catch {
    throw new BadRequestError('The sign-in request expired or was tampered with. Please try again.');
  }

  if (payload.provider !== expectedProvider) {
    throw new BadRequestError('OAuth state does not match the requested provider');
  }

  return payload.redirectTo === undefined ? {} : { redirectTo: payload.redirectTo };
}

// --- Flow -------------------------------------------------------------------

export function buildAuthorizeUrl(provider: ProviderKey, state: string): string {
  const config = requireConfigured(provider);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri(provider),
    response_type: 'code',
    scope: config.scope,
    state,
  });

  // Google needs these to reliably return a refresh token.
  if (provider === 'google') {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  }

  return `${config.authorizeUrl}?${params.toString()}`;
}

export async function exchangeCode(provider: ProviderKey, code: string): Promise<string> {
  const config = requireConfigured(provider);

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(provider),
  });

  const data = await requestJson<{ access_token?: string; error?: string }>(
    config.tokenUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // GitHub returns form-encoded data unless JSON is requested.
        Accept: 'application/json',
      },
      body,
    },
    `${provider} token exchange`,
  );

  if (!data.access_token) {
    throw new AppError('OAuth provider did not return an access token', 502, 'OAUTH_NO_TOKEN');
  }

  return data.access_token;
}

export async function fetchProfile(
  provider: ProviderKey,
  accessToken: string,
): Promise<OAuthProfile> {
  return providers[provider].fetchProfile(accessToken);
}

export const oauthService = {
  buildAuthorizeUrl,
  exchangeCode,
  fetchProfile,
  createState,
  verifyState,
  isProviderConfigured,
  listConfiguredProviders,
  toProviderEnum,
} as const;
