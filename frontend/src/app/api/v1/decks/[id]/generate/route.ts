import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created, ok } from '@/server/lib/response';
import { flashcardService } from '@/server/services/flashcard.service';
import { aiStudyService } from '@/server/services/ai-study.service';
import { generateCardsSchema } from '@/server/validators/flashcard.validator';

export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const input = await readJson(req, generateCardsSchema);
  const result = await aiStudyService.generateFlashcards({ source: input.source, count: input.count, difficulty: input.difficulty });

  if (!input.save) {
    return ok({ cards: result.cards, saved: 0, model: result.model, totalTokens: result.totalTokens });
  }
  const saved = await flashcardService.createCards(user.id, params.id, result.cards);
  return created({ cards: result.cards, saved, model: result.model, totalTokens: result.totalTokens });
});
