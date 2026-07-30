import type { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/server/lib/auth';
import { readQuery, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { adminService } from '@/server/services/admin.service';
import { overviewSchema } from '@/server/validators/admin.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  requireRole(user, 'ADMIN');
  const { days } = readQuery(req, overviewSchema);
  return ok(await adminService.getOverview(days));
});
