import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readQuery, route } from '@/server/lib/handler';
import { paginated } from '@/server/lib/response';
import { universitySyncService } from '@/server/services/university-sync.service';
import { listSyncLogsSchema } from '@/server/validators/university.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const query = readQuery(req, listSyncLogsSchema);
  const result = await universitySyncService.listSyncLogs(user.id, query);
  return paginated(result.items, result.pagination);
});
