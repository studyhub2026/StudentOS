import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { flashcardService } from '@/server/services/flashcard.service';
import { updateCardSchema } from '@/server/validators/flashcard.validator';

export const PATCH = route<{ cardId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await flashcardService.updateCard(user.id, params.cardId, await readJson(req, updateCardSchema)));
});

export const DELETE = route<{ cardId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await flashcardService.deleteCard(user.id, params.cardId);
  return ok({ message: 'Card deleted' });
});
