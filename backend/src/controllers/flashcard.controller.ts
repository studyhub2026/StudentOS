import type { Request, Response } from 'express';
import { aiStudyService } from '../services/ai-study.service.js';
import { flashcardService } from '../services/flashcard.service.js';
import { BadRequestError, UnauthorizedError } from '../utils/errors.js';
import type {
  CreateCardInput,
  CreateDeckInput,
  GenerateCardsInput,
  ImportDeckInput,
  ListCardsQuery,
  UpdateCardInput,
  UpdateDeckInput,
} from '../validators/flashcard.validator.js';

function userId(req: Request): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}

// --- Decks ------------------------------------------------------------------

export async function listDecks(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await flashcardService.listDecks(userId(req)) });
}

export async function getDeck(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await flashcardService.getDeck(userId(req), req.params.id as string) });
}

export async function createDeck(req: Request, res: Response): Promise<void> {
  const deck = await flashcardService.createDeck(userId(req), req.body as CreateDeckInput);
  res.status(201).json({ success: true, data: deck });
}

export async function updateDeck(req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    data: await flashcardService.updateDeck(
      userId(req),
      req.params.id as string,
      req.body as UpdateDeckInput,
    ),
  });
}

export async function removeDeck(req: Request, res: Response): Promise<void> {
  await flashcardService.deleteDeck(userId(req), req.params.id as string);
  res.json({ success: true, data: { message: 'Deck deleted' } });
}

export async function resetDeck(req: Request, res: Response): Promise<void> {
  const count = await flashcardService.resetCards(userId(req), req.params.id as string);
  res.json({ success: true, data: { reset: count } });
}

// --- Cards ------------------------------------------------------------------

export async function listCards(req: Request, res: Response): Promise<void> {
  const result = await flashcardService.listCards(
    userId(req),
    req.params.id as string,
    req.query as unknown as ListCardsQuery,
  );
  res.json({ success: true, data: result.items, pagination: result.pagination });
}

export async function createCard(req: Request, res: Response): Promise<void> {
  const card = await flashcardService.createCard(
    userId(req),
    req.params.id as string,
    req.body as CreateCardInput,
  );
  res.status(201).json({ success: true, data: card });
}

export async function bulkCreateCards(req: Request, res: Response): Promise<void> {
  const { cards } = req.body as { cards: CreateCardInput[] };
  const created = await flashcardService.createCards(userId(req), req.params.id as string, cards);
  res.status(201).json({ success: true, data: { created } });
}

export async function updateCard(req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    data: await flashcardService.updateCard(
      userId(req),
      req.params.cardId as string,
      req.body as UpdateCardInput,
    ),
  });
}

export async function removeCard(req: Request, res: Response): Promise<void> {
  await flashcardService.deleteCard(userId(req), req.params.cardId as string);
  res.json({ success: true, data: { message: 'Card deleted' } });
}

// --- Review -----------------------------------------------------------------

export async function reviewQueue(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as {
    deckId?: string;
    limit: number;
    newLimit: number;
  };

  const queue = await flashcardService.getReviewQueue(userId(req), {
    deckId: query.deckId,
    limit: query.limit,
    newLimit: query.newLimit,
  });

  res.json({ success: true, data: queue });
}

export async function reviewCard(req: Request, res: Response): Promise<void> {
  const { rating, responseMs } = req.body as {
    rating: 'again' | 'hard' | 'good' | 'easy';
    responseMs?: number;
  };

  const outcome = await flashcardService.reviewCard(
    userId(req),
    req.params.cardId as string,
    rating,
    responseMs,
  );

  res.json({ success: true, data: outcome });
}

export async function stats(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as {
    deckId?: string;
    heatmapDays: number;
    forecastDays: number;
  };

  res.json({
    success: true,
    data: await flashcardService.getStats(userId(req), {
      deckId: query.deckId,
      heatmapDays: query.heatmapDays,
      forecastDays: query.forecastDays,
    }),
  });
}

// --- AI generation ----------------------------------------------------------

/**
 * Generates cards with Gemini. Returns a preview by default so the student can
 * edit before committing; `save: true` writes them straight into the deck.
 */
export async function generateCards(req: Request, res: Response): Promise<void> {
  const deckId = req.params.id as string;
  const input = req.body as GenerateCardsInput;

  const result = await aiStudyService.generateFlashcards({
    source: input.source,
    count: input.count,
    difficulty: input.difficulty,
  });

  if (!input.save) {
    res.json({
      success: true,
      data: { cards: result.cards, saved: 0, model: result.model, totalTokens: result.totalTokens },
    });
    return;
  }

  const created = await flashcardService.createCards(userId(req), deckId, result.cards);

  res.status(201).json({
    success: true,
    data: { cards: result.cards, saved: created, model: result.model, totalTokens: result.totalTokens },
  });
}

// --- Import / export --------------------------------------------------------

export async function exportDeck(req: Request, res: Response): Promise<void> {
  const deck = await flashcardService.exportDeck(userId(req), req.params.id as string);
  const format = req.query.format === 'csv' ? 'csv' : 'json';

  // Filesystem-hostile characters are stripped from the download filename.
  const safeName = deck.name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'deck';

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.csv"`);
    res.send(flashcardService.toCsv(deck));
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.json"`);
  res.send(JSON.stringify(deck, null, 2));
}

export async function importDeck(req: Request, res: Response): Promise<void> {
  const input = req.body as ImportDeckInput;
  const owner = userId(req);

  let name = input.deckName;
  let cards: CreateCardInput[];

  if (input.format === 'csv') {
    cards = flashcardService.parseCsv(input.data).map((card) => ({
      ...card,
      difficulty: 'MEDIUM' as const,
    }));
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.data);
    } catch {
      throw new BadRequestError('That file is not valid JSON');
    }

    const payload = parsed as { name?: unknown; cards?: unknown };
    if (!Array.isArray(payload.cards)) {
      throw new BadRequestError('The file must contain a "cards" array');
    }

    name ??= typeof payload.name === 'string' ? payload.name : undefined;

    cards = payload.cards
      .filter(
        (card): card is { front: string; back: string; hint?: string; tags?: string[] } =>
          typeof card === 'object' &&
          card !== null &&
          typeof (card as { front?: unknown }).front === 'string' &&
          typeof (card as { back?: unknown }).back === 'string',
      )
      .map((card) => ({
        front: card.front.trim(),
        back: card.back.trim(),
        hint: card.hint?.trim() ?? null,
        tags: Array.isArray(card.tags) ? card.tags : [],
        difficulty: 'MEDIUM' as const,
      }))
      .filter((card) => card.front !== '' && card.back !== '');
  }

  if (cards.length === 0) {
    throw new BadRequestError('No valid cards were found in that file');
  }

  const deck = await flashcardService.createDeck(owner, {
    name: name ?? 'Imported deck',
    color: '#14b8a6',
  } as CreateDeckInput);

  const created = await flashcardService.createCards(owner, deck.id, cards);

  res.status(201).json({ success: true, data: { deck, imported: created } });
}
