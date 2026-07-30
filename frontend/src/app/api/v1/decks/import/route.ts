import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created } from '@/server/lib/response';
import { flashcardService } from '@/server/services/flashcard.service';
import { BadRequestError } from '@/server/lib/errors';
import { importDeckSchema } from '@/server/validators/flashcard.validator';
import type { CreateCardInput } from '@/server/validators/flashcard.validator';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const input = await readJson(req, importDeckSchema);

  let name = input.deckName;
  let cards: CreateCardInput[];

  if (input.format === 'csv') {
    cards = flashcardService.parseCsv(input.data).map((card) => ({ ...card, difficulty: 'MEDIUM' as const }));
  } else {
    let parsed: unknown;
    try { parsed = JSON.parse(input.data); } catch { throw new BadRequestError('That file is not valid JSON'); }
    const payload = parsed as { name?: unknown; cards?: unknown };
    if (!Array.isArray(payload.cards)) throw new BadRequestError('The file must contain a "cards" array');
    name ??= typeof payload.name === 'string' ? payload.name : undefined;
    cards = payload.cards
      .filter((c): c is { front: string; back: string; hint?: string; tags?: string[] } =>
        typeof c === 'object' && c !== null &&
        typeof (c as { front?: unknown }).front === 'string' &&
        typeof (c as { back?: unknown }).back === 'string')
      .map((c) => ({ front: c.front.trim(), back: c.back.trim(), hint: c.hint?.trim() ?? null, tags: Array.isArray(c.tags) ? c.tags : [], difficulty: 'MEDIUM' as const }))
      .filter((c) => c.front !== '' && c.back !== '');
  }

  if (cards.length === 0) throw new BadRequestError('No valid cards were found in that file');

  const deck = await flashcardService.createDeck(user.id, { name: name ?? 'Imported deck', color: '#14b8a6' } as Parameters<typeof flashcardService.createDeck>[1]);
  const imported = await flashcardService.createCards(user.id, deck.id, cards);
  return created({ deck, imported });
});
