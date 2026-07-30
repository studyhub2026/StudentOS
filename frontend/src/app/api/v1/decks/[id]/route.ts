import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { flashcardService } from '@/server/services/flashcard.service';
import { updateDeckSchema } from '@/server/validators/flashcard.validator';

export const GET = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await flashcardService.getDeck(user.id, params.id));
});

export const PATCH = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await flashcardService.updateDeck(user.id, params.id, await readJson(req, updateDeckSchema)));
});

export const DELETE = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await flashcardService.deleteDeck(user.id, params.id);
  return ok({ message: 'Deck deleted' });
});
