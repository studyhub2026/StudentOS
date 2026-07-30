import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { groupService } from '@/server/services/group.service';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const search = req.nextUrl.searchParams.get('search') ?? undefined;
  return ok(await groupService.discoverGroups(user.id, search));
});
