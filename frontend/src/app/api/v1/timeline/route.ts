import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/lib/auth';
import { readQuery, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { getTimeline } from '@/server/services/timeline.service';

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  limit: z.coerce.number().int().min(10).max(500).optional(),
});

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { days, limit } = readQuery(req, querySchema);
  const since = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;
  const events = await getTimeline(user.id, {
    ...(since ? { since } : {}),
    ...(limit ? { limit } : {}),
  });
  return ok({ events });
});
