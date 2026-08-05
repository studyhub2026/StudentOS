import type { NextRequest } from 'next/server';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { NotFoundError } from '@/server/lib/errors';
import { getPublicProfile } from '@/server/services/profile.service';

/**
 * Public, unauthenticated read of a student's opt-in profile. Returns 404 for
 * unknown usernames AND for users whose settings.profilePublic is false — the
 * two cases are indistinguishable to callers by design, so account existence
 * cannot be probed via this endpoint.
 */
export const GET = route<{ username: string }>(async (_req: NextRequest, { params }) => {
  const profile = await getPublicProfile(params.username);
  if (!profile) throw new NotFoundError('Profile');
  return ok(profile);
});
