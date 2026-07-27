import { oauthService } from '@/server/services/oauth.service';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';

export const GET = route(async () => {
  return ok({ providers: oauthService.listConfiguredProviders() });
});
