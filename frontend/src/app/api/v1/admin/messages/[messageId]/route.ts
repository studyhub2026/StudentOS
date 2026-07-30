import type { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { adminService } from '@/server/services/admin.service';
import { moderateMessageSchema } from '@/server/validators/admin.validator';

export const DELETE = route<{ messageId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  requireRole(user, 'ADMIN');
  const { reason } = await readJson(req, moderateMessageSchema);
  await adminService.moderateMessage(user.id, params.messageId, reason);
  return ok({ message: 'Message removed' });
});
