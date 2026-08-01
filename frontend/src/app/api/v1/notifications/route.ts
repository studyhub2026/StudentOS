import { NextRequest } from 'next/server';
import { z } from 'zod';
import { route, readQuery } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok } from '@/server/lib/response';
import { getNotifications, generateSmartNotifications } from '@/server/services/ai-notification.service';

const querySchema = z.object({
  unread: z.coerce.boolean().optional(),
});

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { unread } = readQuery(req, querySchema);
  const notifications = await getNotifications(user.id, unread);
  return ok(notifications);
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const notifications = await generateSmartNotifications(user.id);
  return ok(notifications);
});
