import 'server-only';
import { LmsProvider } from '@prisma/client';
import { env } from '@/server/env';
import type { Capability, ProviderStatus } from './capabilities';

/**
 * The single source of truth for provider metadata across the entire LMS
 * platform. Both the sync engine and the client-side UI derive their
 * behaviour from this table. Adding a new LMS is a matter of adding a row
 * here and a new file next to canvas.ts/moodle.ts — no other code paths
 * need to know about it.
 *
 * Keys are the Prisma LmsProvider enum values so the compiler catches any
 * drift between the schema and this table.
 */

export type AuthMode = 'oauth' | 'token';

export interface LmsProviderMeta {
  id: LmsProvider;
  /** URL-safe short id used in /api/v1/university/oauth/{slug}/... routes. */
  slug: string;
  displayName: string;
  /** Emoji icon used in listing chips. Non-technical brand-neutral pointer. */
  icon: string;
  /** Brand-hint colour used sparingly in the UI (mostly badges). */
  color: string;
  authMode: AuthMode;
  /** Semver of the adapter — persisted on LmsConnection at connect time. */
  adapterVersion: string;
  status: ProviderStatus;
  capabilities: readonly Capability[];
  /** Human-visible link so the docs card can point users at the right place. */
  documentationUrl: string;
  /** Short note shown in the health dashboard, e.g. "Coming in Q1". */
  notes?: string;
}

const canvasReady = (): boolean => Boolean(env.CANVAS_CLIENT_ID && env.CANVAS_CLIENT_SECRET);

// Note: the `status` field reflects code-level readiness, not runtime health.
// Runtime health (token expired, portal unreachable, sync failing) is per-
// connection and lives in LmsConnection.status.
const REGISTRY: LmsProviderMeta[] = [
  {
    id: LmsProvider.CANVAS,
    slug: 'canvas',
    displayName: 'Canvas LMS',
    icon: '🎨',
    color: '#e4060a',
    authMode: 'oauth',
    adapterVersion: '1.0.0',
    status: 'LIVE',
    capabilities: [
      'COURSES',
      'ASSIGNMENTS',
      'QUIZZES',
      'GRADES',
      'CALENDAR',
      'ANNOUNCEMENTS',
      'FILES',
      'DISCUSSION_FORUMS',
      'RUBRICS',
      'LEARNING_OUTCOMES',
    ],
    documentationUrl: 'https://canvas.instructure.com/doc/api/',
  },
  {
    id: LmsProvider.MOODLE,
    slug: 'moodle',
    displayName: 'Moodle',
    icon: '📘',
    color: '#f98012',
    authMode: 'token',
    adapterVersion: '1.0.0',
    status: 'LIVE',
    capabilities: [
      'COURSES',
      'ASSIGNMENTS',
      'QUIZZES',
      'GRADES',
      'CALENDAR',
      'ANNOUNCEMENTS',
      'FILES',
      'DISCUSSION_FORUMS',
    ],
    documentationUrl: 'https://docs.moodle.org/dev/Web_services',
    notes: 'Uses per-user Web Services tokens generated in the student portal.',
  },
  {
    id: LmsProvider.GOOGLE_CLASSROOM,
    slug: 'google-classroom',
    displayName: 'Google Classroom',
    icon: '📗',
    color: '#1a73e8',
    authMode: 'oauth',
    adapterVersion: '0.1.0',
    status: 'IN_DEVELOPMENT',
    capabilities: ['COURSES', 'ASSIGNMENTS', 'ANNOUNCEMENTS', 'FILES', 'GRADES'],
    documentationUrl: 'https://developers.google.com/classroom',
    notes: 'Adapter under active development.',
  },
  {
    id: LmsProvider.BLACKBOARD,
    slug: 'blackboard',
    displayName: 'Blackboard Learn',
    icon: '⚫',
    color: '#262626',
    authMode: 'oauth',
    adapterVersion: '0.0.0',
    status: 'PLANNED',
    capabilities: [
      'COURSES',
      'ASSIGNMENTS',
      'GRADES',
      'CALENDAR',
      'ANNOUNCEMENTS',
      'FILES',
      'DISCUSSION_FORUMS',
      'ATTENDANCE',
      'RUBRICS',
    ],
    documentationUrl: 'https://developer.blackboard.com/portal/displayApi',
    notes: 'Planned after Google Classroom.',
  },
  {
    id: LmsProvider.BRIGHTSPACE,
    slug: 'brightspace',
    displayName: 'Brightspace (D2L)',
    icon: '🟦',
    color: '#006fbf',
    authMode: 'oauth',
    adapterVersion: '0.0.0',
    status: 'PLANNED',
    capabilities: [
      'COURSES',
      'ASSIGNMENTS',
      'QUIZZES',
      'GRADES',
      'CALENDAR',
      'ANNOUNCEMENTS',
      'FILES',
      'RUBRICS',
      'LEARNING_OUTCOMES',
    ],
    documentationUrl: 'https://docs.valence.desire2learn.com/',
  },
  {
    id: LmsProvider.MS_TEAMS,
    slug: 'ms-teams',
    displayName: 'MS Teams for Education',
    icon: '🟪',
    color: '#6264a7',
    authMode: 'oauth',
    adapterVersion: '0.0.0',
    status: 'PLANNED',
    capabilities: [
      'COURSES',
      'ASSIGNMENTS',
      'CALENDAR',
      'ANNOUNCEMENTS',
      'FILES',
      'MESSAGES',
      'VIDEO_LECTURES',
    ],
    documentationUrl:
      'https://learn.microsoft.com/en-us/graph/api/resources/educationclass',
  },
  {
    id: LmsProvider.SAKAI,
    slug: 'sakai',
    displayName: 'Sakai',
    icon: '🟨',
    color: '#1a73e8',
    authMode: 'oauth',
    adapterVersion: '0.0.0',
    status: 'PLANNED',
    capabilities: [
      'COURSES',
      'ASSIGNMENTS',
      'GRADES',
      'CALENDAR',
      'ANNOUNCEMENTS',
      'FILES',
      'DISCUSSION_FORUMS',
    ],
    documentationUrl: 'https://www.sakailms.org/documentation',
  },
];

/**
 * Client-visible view of a provider — mirrors the server registry but strips
 * anything that would leak infra state, and folds in per-server runtime flags
 * (like "the admin hasn't set CANVAS_CLIENT_ID, so Canvas is disabled here").
 */
export interface LmsProviderPublicMeta {
  id: LmsProvider;
  slug: string;
  displayName: string;
  icon: string;
  color: string;
  authMode: AuthMode;
  adapterVersion: string;
  status: ProviderStatus;
  capabilities: readonly Capability[];
  documentationUrl: string;
  notes?: string;
  /** True when the code is LIVE AND the server has whatever credentials it needs. */
  ready: boolean;
  /** Human-readable reason when `ready` is false, e.g. "Server missing CANVAS_CLIENT_ID". */
  readyReason?: string;
}

function readinessFor(meta: LmsProviderMeta): { ready: boolean; reason?: string } {
  if (meta.status !== 'LIVE') {
    return { ready: false, reason: `Adapter status is ${meta.status.toLowerCase().replace('_', ' ')}` };
  }
  if (meta.id === LmsProvider.CANVAS && !canvasReady()) {
    return { ready: false, reason: 'Server missing CANVAS_CLIENT_ID / CANVAS_CLIENT_SECRET' };
  }
  return { ready: true };
}

// --- Lookups --------------------------------------------------------------

export function listRegistry(): LmsProviderMeta[] {
  return REGISTRY.slice();
}

export function listPublicRegistry(): LmsProviderPublicMeta[] {
  return REGISTRY.map((m) => {
    const r = readinessFor(m);
    return {
      id: m.id,
      slug: m.slug,
      displayName: m.displayName,
      icon: m.icon,
      color: m.color,
      authMode: m.authMode,
      adapterVersion: m.adapterVersion,
      status: m.status,
      capabilities: m.capabilities,
      documentationUrl: m.documentationUrl,
      notes: m.notes,
      ready: r.ready,
      ...(r.reason ? { readyReason: r.reason } : {}),
    };
  });
}

export function getMeta(provider: LmsProvider): LmsProviderMeta {
  const meta = REGISTRY.find((m) => m.id === provider);
  if (!meta) throw new Error(`Unknown LMS provider: ${provider}`);
  return meta;
}

export function hasCapability(provider: LmsProvider, capability: Capability): boolean {
  return getMeta(provider).capabilities.includes(capability);
}

export function metaBySlug(slug: string): LmsProviderMeta | null {
  return REGISTRY.find((m) => m.slug === slug) ?? null;
}
