import 'server-only';
import { LmsProvider } from '@prisma/client';
import { env } from '@/server/env';
import { AppError } from '@/server/lib/errors';
import type { AdapterConfig, LmsAdapter } from './types';
import { CanvasAdapter } from './canvas';
import { MoodleAdapter } from './moodle';
import type { SyncMetrics } from './metrics';
import { getMeta, hasCapability as registryHasCapability } from './registry';
import type { AuthMode } from './registry';

/**
 * Adapter factory. Provider metadata lives in registry.ts — this file only
 * knows how to instantiate the right concrete adapter class per provider.
 * Adding a new provider is a two-step operation: register it in registry.ts,
 * then add a case here that returns the new adapter.
 */

function redirectUri(provider: LmsProvider): string {
  const slug = providerSlug(provider);
  return `${env.APP_URL}/api/v1/university/oauth/${slug}/callback`;
}

/** URL-safe slug used in the OAuth callback path. */
export function providerSlug(provider: LmsProvider): string {
  return getMeta(provider).slug;
}

export function slugToProvider(slug: string): LmsProvider | null {
  const map: Record<string, LmsProvider> = {
    canvas: LmsProvider.CANVAS,
    moodle: LmsProvider.MOODLE,
    blackboard: LmsProvider.BLACKBOARD,
    brightspace: LmsProvider.BRIGHTSPACE,
    sakai: LmsProvider.SAKAI,
    'google-classroom': LmsProvider.GOOGLE_CLASSROOM,
    'ms-teams': LmsProvider.MS_TEAMS,
  };
  return map[slug] ?? null;
}

function credentialsFor(provider: LmsProvider): { clientId: string; clientSecret: string } {
  switch (provider) {
    case LmsProvider.CANVAS:
      return { clientId: env.CANVAS_CLIENT_ID ?? '', clientSecret: env.CANVAS_CLIENT_SECRET ?? '' };
    default:
      return { clientId: '', clientSecret: '' };
  }
}

export type { AuthMode };

export function authModeFor(provider: LmsProvider): AuthMode {
  return getMeta(provider).authMode;
}

/** Registry status LIVE + any server-side credential requirements met. */
export function isProviderReady(provider: LmsProvider): boolean {
  const meta = getMeta(provider);
  if (meta.status !== 'LIVE') return false;
  switch (provider) {
    case LmsProvider.CANVAS: {
      const { clientId, clientSecret } = credentialsFor(provider);
      return Boolean(clientId && clientSecret);
    }
    case LmsProvider.MOODLE:
      // Moodle uses per-user tokens — no server credentials required.
      return true;
    default:
      return false;
  }
}

/** Re-export so callers don't have to reach into ./registry directly. */
export const hasCapability = registryHasCapability;

export function getAdapter(
  provider: LmsProvider,
  portalUrl: string,
  metrics?: SyncMetrics,
): LmsAdapter {
  const { clientId, clientSecret } = credentialsFor(provider);
  const config: AdapterConfig = {
    portalUrl: portalUrl.replace(/\/$/, ''),
    redirectUri: redirectUri(provider),
    clientId,
    clientSecret,
  };

  switch (provider) {
    case LmsProvider.CANVAS:
      if (!clientId || !clientSecret) {
        throw new AppError(
          'Canvas OAuth is not configured on this server (set CANVAS_CLIENT_ID and CANVAS_CLIENT_SECRET)',
          503,
          'LMS_NOT_CONFIGURED',
        );
      }
      return new CanvasAdapter(config, metrics);
    case LmsProvider.MOODLE:
      return new MoodleAdapter(config, metrics);
    default:
      throw new AppError(
        `The ${provider} adapter is not implemented yet`,
        501,
        'LMS_ADAPTER_NOT_IMPLEMENTED',
      );
  }
}
