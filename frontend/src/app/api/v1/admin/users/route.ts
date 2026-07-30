import type { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/server/lib/auth';
import { readQuery, route } from '@/server/lib/handler';
import { paginated } from '@/server/lib/response';
import { adminService } from '@/server/services/admin.service';
import { listUsersSchema } from '@/server/validators/admin.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  requireRole(user, 'ADMIN');
  const result = await adminService.listUsers(readQuery(req, listUsersSchema));
  return paginated(result.items, result.pagination);
});
