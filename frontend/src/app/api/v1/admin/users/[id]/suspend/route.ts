import type { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { adminService } from '@/server/services/admin.service';
import { suspendUserSchema } from '@/server/validators/admin.validator';

export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  requireRole(user, 'ADMIN');
  const { reason } = await readJson(req, suspendUserSchema);
  await adminService.suspendUser(user.id, params.id, reason);
  return ok({ message: 'Account suspended' });
});
