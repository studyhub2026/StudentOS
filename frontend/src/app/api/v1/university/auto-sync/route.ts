import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { universitySyncService } from '@/server/services/university-sync.service';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const dueIds = await universitySyncService.getConnectionsDueForSync(user.id);
  const results: { connectionId: string; jobId?: string; syncLogId?: string }[] = [];
  for (const id of dueIds) {
    const result = await universitySyncService.triggerSync(user.id, id);
    results.push({ connectionId: id, ...result });
  }
  return ok({ synced: results.length, results });
});
