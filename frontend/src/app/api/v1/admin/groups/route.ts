import type { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/server/lib/auth';
import { readQuery, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { adminService } from '@/server/services/admin.service';
import { listGroupsSchema } from '@/server/validators/admin.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  requireRole(user, 'ADMIN');
  return ok(await adminService.listGroups(readQuery(req, listGroupsSchema)));
});
