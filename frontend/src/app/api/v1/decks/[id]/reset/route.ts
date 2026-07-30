import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { flashcardService } from '@/server/services/flashcard.service';

export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const reset = await flashcardService.resetCards(user.id, params.id);
  return ok({ reset });
});
