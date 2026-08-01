import { NextRequest } from 'next/server';
import { z } from 'zod';
import { route, readJson } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok } from '@/server/lib/response';
import { askKnowledge } from '@/server/services/knowledge.service';

const bodySchema = z.object({
  question: z.string().min(1).max(2000),
  collectionId: z.string().optional(),
  documentIds: z.array(z.string()).max(20).optional(),
  citeSources: z.boolean().optional(),
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const body = await readJson(req, bodySchema);
  const result = await askKnowledge(user.id, body.question, body);
  return ok(result);
});
