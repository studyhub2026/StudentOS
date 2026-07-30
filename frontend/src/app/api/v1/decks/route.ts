import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created, ok } from '@/server/lib/response';
import { flashcardService } from '@/server/services/flashcard.service';
import { createDeckSchema } from '@/server/validators/flashcard.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return ok(await flashcardService.listDecks(user.id));
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return created(await flashcardService.createDeck(user.id, await readJson(req, createDeckSchema)));
});
