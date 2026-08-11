import type { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { adminService } from '@/server/services/admin.service';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  requireRole(user, 'ADMIN');
  return ok(await adminService.getUniversityOverview());
});
