import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { flashcardService } from '@/server/services/flashcard.service';
import { reviewCardSchema } from '@/server/validators/flashcard.validator';

export const POST = route<{ cardId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { rating, responseMs } = await readJson(req, reviewCardSchema);
  return ok(await flashcardService.reviewCard(user.id, params.cardId, rating, responseMs));
});
