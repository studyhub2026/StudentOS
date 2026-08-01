import { NextRequest } from 'next/server';
import { z } from 'zod';
import { route, readQuery } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok } from '@/server/lib/response';
import { searchKnowledge } from '@/server/services/knowledge.service';

const querySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { q, limit } = readQuery(req, querySchema);
  const results = await searchKnowledge(user.id, q, limit);
  return ok(results);
});
