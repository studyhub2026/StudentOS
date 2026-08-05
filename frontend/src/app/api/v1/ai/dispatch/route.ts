import { NextRequest } from 'next/server';
import { z } from 'zod';
import { route, readJson } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { runDispatch } from '@/server/services/ai-dispatch.service';

export const maxDuration = 60;

const bodySchema = z.object({
  text: z.string().min(3).max(4000),
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'ai-dispatch', ...TUTOR_LIMITS.generation });
  const { text } = await readJson(req, bodySchema);
  const result = await runDispatch(user.id, text);
  return ok(result);
});
