import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readQuery, route } from '@/server/lib/handler';
import { paginated } from '@/server/lib/response';
import { focusService } from '@/server/services/focus.service';
import { listSessionsSchema } from '@/server/validators/schedule.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const result = await focusService.listSessions(user.id, readQuery(req, listSessionsSchema));
  return paginated(result.items, result.pagination);
});
