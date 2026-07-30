import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created } from '@/server/lib/response';
import { flashcardService } from '@/server/services/flashcard.service';
import { bulkCreateCardsSchema } from '@/server/validators/flashcard.validator';

export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { cards } = await readJson(req, bulkCreateCardsSchema);
  const createdCount = await flashcardService.createCards(user.id, params.id, cards);
  return created({ created: createdCount });
});
