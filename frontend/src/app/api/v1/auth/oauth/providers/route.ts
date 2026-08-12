import { oauthService } from '@/server/services/oauth.service';
import { route } from '@/server/lib/handler';
import { cachedOk } from '@/server/lib/response';

/**
 * Public list of configured OAuth providers on this deployment. Derived
 * purely from env — safe to cache at the edge; changes on redeploy.
 */
export const GET = route(async () => {
  return cachedOk(
    { providers: oauthService.listConfiguredProviders() },
    { sMaxAge: 600, swr: 1200 },
  );
});
