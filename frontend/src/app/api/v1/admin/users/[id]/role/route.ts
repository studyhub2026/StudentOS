import type { NextRequest } from 'next/server';
import type { Role } from '@prisma/client';
import { requireAuth, requireRole } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { adminService } from '@/server/services/admin.service';
import { changeRoleSchema } from '@/server/validators/admin.validator';

export const PATCH = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  requireRole(user, 'ADMIN');
  const { role } = await readJson(req, changeRoleSchema);
  await adminService.changeRole(user.id, params.id, role as Role);
  return ok({ message: `Role changed to ${role}` });
});
