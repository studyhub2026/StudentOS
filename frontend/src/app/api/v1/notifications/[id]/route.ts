import { NextRequest } from 'next/server';
import { route } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok } from '@/server/lib/response';
import { markNotificationRead } from '@/server/services/ai-notification.service';

export const PATCH = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await markNotificationRead(user.id, params.id);
  return ok({ read: true });
});
