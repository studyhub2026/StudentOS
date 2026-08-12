import 'server-only';
import { LmsProvider } from '@prisma/client';
import { env } from '@/server/env';
import { AppError } from '@/server/lib/errors';
import type { AdapterConfig, LmsAdapter } from './types';
import { CanvasAdapter } from './canvas';
import { MoodleAdapter } from './moodle';
import { GoogleClassroomAdapter } from './google-classroom';
import { BlackboardAdapter } from './blackboard';
import { BrightspaceAdapter } from './brightspace';
import { MsTeamsAdapter } from './ms-teams';
import { SakaiAdapter } from './sakai';
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
    case LmsProvider.GOOGLE_CLASSROOM:
      // Reuses the Google OAuth credentials already configured for sign-in —
      // no separate developer key needed. The scopes at authorize time
      // determine what the Classroom adapter can actually read.
      return { clientId: env.GOOGLE_CLIENT_ID ?? '', clientSecret: env.GOOGLE_CLIENT_SECRET ?? '' };
    case LmsProvider.BLACKBOARD:
      return {
        clientId: env.BLACKBOARD_CLIENT_ID ?? '',
        clientSecret: env.BLACKBOARD_CLIENT_SECRET ?? '',
      };
    case LmsProvider.BRIGHTSPACE:
      return {
        clientId: env.BRIGHTSPACE_CLIENT_ID ?? '',
        clientSecret: env.BRIGHTSPACE_CLIENT_SECRET ?? '',
      };
    case LmsProvider.MS_TEAMS:
      return { clientId: env.MS_CLIENT_ID ?? '', clientSecret: env.MS_CLIENT_SECRET ?? '' };
    case LmsProvider.SAKAI:
      return { clientId: env.SAKAI_CLIENT_ID ?? '', clientSecret: env.SAKAI_CLIENT_SECRET ?? '' };
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
    case LmsProvider.MOODLE:
      // Moodle uses per-user tokens — no server credentials required.
      return true;
    case LmsProvider.CANVAS:
    case LmsProvider.GOOGLE_CLASSROOM:
    case LmsProvider.BLACKBOARD:
    case LmsProvider.BRIGHTSPACE:
    case LmsProvider.MS_TEAMS:
    case LmsProvider.SAKAI: {
      const { clientId, clientSecret } = credentialsFor(provider);
      return Boolean(clientId && clientSecret);
    }
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
    case LmsProvider.GOOGLE_CLASSROOM:
      if (!clientId || !clientSecret) {
        throw new AppError(
          'Google Classroom is not configured on this server (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)',
          503,
          'LMS_NOT_CONFIGURED',
        );
      }
      return new GoogleClassroomAdapter(config, metrics);
    case LmsProvider.BLACKBOARD:
      if (!clientId || !clientSecret) {
        throw new AppError(
          'Blackboard is not configured on this server (set BLACKBOARD_CLIENT_ID and BLACKBOARD_CLIENT_SECRET)',
          503,
          'LMS_NOT_CONFIGURED',
        );
      }
      return new BlackboardAdapter(config, metrics);
    case LmsProvider.BRIGHTSPACE:
      if (!clientId || !clientSecret) {
        throw new AppError(
          'Brightspace is not configured on this server (set BRIGHTSPACE_CLIENT_ID and BRIGHTSPACE_CLIENT_SECRET)',
          503,
          'LMS_NOT_CONFIGURED',
        );
      }
      return new BrightspaceAdapter(config, metrics);
    case LmsProvider.MS_TEAMS:
      if (!clientId || !clientSecret) {
        throw new AppError(
          'MS Teams is not configured on this server (set MS_CLIENT_ID and MS_CLIENT_SECRET)',
          503,
          'LMS_NOT_CONFIGURED',
        );
      }
      return new MsTeamsAdapter(config, metrics);
    case LmsProvider.SAKAI:
      if (!clientId || !clientSecret) {
        throw new AppError(
          'Sakai is not configured on this server (set SAKAI_CLIENT_ID and SAKAI_CLIENT_SECRET)',
          503,
          'LMS_NOT_CONFIGURED',
        );
      }
      return new SakaiAdapter(config, metrics);
    default:
      throw new AppError(
        `The ${provider} adapter is not implemented yet`,
        501,
        'LMS_ADAPTER_NOT_IMPLEMENTED',
      );
  }
}
