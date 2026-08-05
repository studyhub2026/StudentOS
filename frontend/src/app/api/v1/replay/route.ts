import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/lib/auth';
import { readQuery, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { getReplayForYear } from '@/server/services/replay.service';

const querySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
});

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { year } = readQuery(req, querySchema);
  const targetYear = year ?? new Date().getUTCFullYear();
  const data = await getReplayForYear(user.id, targetYear);
  return ok(data);
});
