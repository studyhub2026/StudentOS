export const maxDuration = 60;
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { aiStudyService } from '@/server/services/ai-study.service';
import { quizSchema } from '@/server/validators/ai.validator';

export const POST = route(async (req: NextRequest) => {
  await requireAuth(req);
  const { source, count } = await readJson(req, quizSchema);
  return ok(await aiStudyService.generateQuiz({ source, count }));
});
