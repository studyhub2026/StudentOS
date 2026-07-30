import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readQuery, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { flashcardService } from '@/server/services/flashcard.service';
import { reviewQueueSchema } from '@/server/validators/flashcard.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const q = readQuery(req, reviewQueueSchema);
  return ok(await flashcardService.getReviewQueue(user.id, { deckId: q.deckId, limit: q.limit, newLimit: q.newLimit }));
});
