import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireAuth } from '@/server/lib/auth';
import { BadRequestError } from '@/server/lib/errors';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { oauthService, type ProviderKey } from '@/server/services/oauth.service';
import { oauthProviderSchema } from '@/server/validators/auth.validator';

// Begins the OAuth flow: redirect the browser to the provider's consent screen.
export const GET = route<{ provider: string }>(async (req: NextRequest, { params }) => {
  const { provider } = oauthProviderSchema.parse(params);
  const redirectTo = req.nextUrl.searchParams.get('redirectTo') ?? undefined;
  const state = oauthService.createState(provider as ProviderKey, redirectTo);
  return NextResponse.redirect(oauthService.buildAuthorizeUrl(provider as ProviderKey, state));
});

// Unlinks a provider, refusing when it is the only way into the account.
export const DELETE = route<{ provider: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { provider } = oauthProviderSchema.parse(params);
  const providerEnum = oauthService.toProviderEnum(provider as ProviderKey);

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true, accounts: { select: { id: true, provider: true } } },
  });
  if (!account) throw new BadRequestError('User not found');

  const linked = account.accounts.find((entry) => entry.provider === providerEnum);
  if (!linked) throw new BadRequestError('That provider is not linked to your account');
  if (!account.passwordHash && account.accounts.length === 1) {
    throw new BadRequestError('This is your only sign-in method. Set a password before unlinking it.');
  }

  await prisma.oAuthAccount.delete({ where: { id: linked.id } });
  return ok({ message: `${provider} unlinked` });
});
