import 'server-only';

export * from './types';
export {
  getAdapter,
  providerSlug,
  slugToProvider,
  isProviderReady,
  authModeFor,
  hasCapability,
  type AuthMode,
} from './factory';
export {
  listRegistry,
  listPublicRegistry,
  getMeta,
  metaBySlug,
  type LmsProviderMeta,
  type LmsProviderPublicMeta,
} from './registry';
export {
  CAPABILITIES,
  CAPABILITY_LABEL,
  PROVIDER_STATUS_LABEL,
  type Capability,
  type ProviderStatus,
} from './capabilities';
export { SyncMetrics, timedFetch } from './metrics';
