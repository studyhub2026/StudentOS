import { NextRequest } from 'next/server';
import { route } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok } from '@/server/lib/response';
import { markAllRead } from '@/server/services/ai-notification.service';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  await markAllRead(user.id);
  return ok({ done: true });
});
