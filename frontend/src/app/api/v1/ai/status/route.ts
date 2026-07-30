import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { aiService } from '@/server/services/ai.service';

export const GET = route(async (req: NextRequest) => {
  await requireAuth(req);
  return ok({
    configured: aiService.isConfigured(),
    provider: 'google-gemini',
    features: ['CHAT','HOMEWORK_HELPER','STUDY_PLANNER','EXAM_SIMULATOR','QUIZ_GENERATOR','FLASHCARD_GENERATOR','SUMMARIZER','CONCEPT_EXPLAINER','MOTIVATION_COACH','REVISION_GENERATOR','LEARNING_PATH'],
  });
});
