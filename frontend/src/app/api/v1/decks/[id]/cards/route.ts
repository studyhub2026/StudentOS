import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, readQuery, route } from '@/server/lib/handler';
import { created, paginated } from '@/server/lib/response';
import { flashcardService } from '@/server/services/flashcard.service';
import { createCardSchema, listCardsSchema } from '@/server/validators/flashcard.validator';

export const GET = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const result = await flashcardService.listCards(user.id, params.id, readQuery(req, listCardsSchema));
  return paginated(result.items, result.pagination);
});

export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return created(await flashcardService.createCard(user.id, params.id, await readJson(req, createCardSchema)));
});
