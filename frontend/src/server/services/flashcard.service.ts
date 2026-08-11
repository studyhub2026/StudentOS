import 'server-only';
import { Prisma, type CardDifficulty } from '@prisma/client';
import { prisma } from '@/server/db';
import { BadRequestError, NotFoundError } from '@/server/lib/errors';
import { emit } from '@/server/services/event-bus';
import {
  MATURE_INTERVAL_DAYS,
  RATING_TO_QUALITY,
  initialState,
  previewIntervals,
  schedule,
  type ReviewRating,
  type SchedulingState,
} from '@/server/services/sm2';
import type {
  CreateCardInput,
  CreateDeckInput,
  ListCardsQuery,
  UpdateCardInput,
  UpdateDeckInput,
} from '@/server/validators/flashcard.validator';

const deckInclude = {
  subject: { select: { id: true, name: true, color: true } },
  _count: { select: { cards: true } },
} satisfies Prisma.FlashcardDeckInclude;

export interface DeckWithCounts {
  id: string;
  name: string;
  description: string | null;
  color: string;
  isPublic: boolean;
  generatedByAi: boolean;
  createdAt: Date;
  updatedAt: Date;
  subject: { id: string; name: string; color: string } | null;
  totalCards: number;
  dueCards: number;
  newCards: number;
  matureCards: number;
}

// --- Decks ------------------------------------------------------------------

export async function listDecks(userId: string): Promise<DeckWithCounts[]> {
  const now = new Date();

  const decks = await prisma.flashcardDeck.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: deckInclude,
  });

  if (decks.length === 0) return [];

  const deckIds = decks.map((deck) => deck.id);

  // Three grouped queries beat a per-deck count; the card table is the one
  // that grows without bound.
  const [dueRows, newRows, matureRows] = await Promise.all([
    prisma.flashcard.groupBy({
      by: ['deckId'],
      where: { deckId: { in: deckIds }, suspended: false, dueAt: { lte: now } },
      _count: { _all: true },
    }),
    prisma.flashcard.groupBy({
      by: ['deckId'],
      where: { deckId: { in: deckIds }, suspended: false, state: 'NEW' },
      _count: { _all: true },
    }),
    prisma.flashcard.groupBy({
      by: ['deckId'],
      where: {
        deckId: { in: deckIds },
        suspended: false,
        intervalDays: { gte: MATURE_INTERVAL_DAYS },
      },
      _count: { _all: true },
    }),
  ]);

  const toMap = (rows: { deckId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((row) => [row.deckId, row._count._all] as const));

  const due = toMap(dueRows);
  const fresh = toMap(newRows);
  const mature = toMap(matureRows);

  return decks.map((deck) => ({
    id: deck.id,
    name: deck.name,
    description: deck.description,
    color: deck.color,
    isPublic: deck.isPublic,
    generatedByAi: deck.generatedByAi,
    createdAt: deck.createdAt,
    updatedAt: deck.updatedAt,
    subject: deck.subject,
    totalCards: deck._count.cards,
    dueCards: due.get(deck.id) ?? 0,
    newCards: fresh.get(deck.id) ?? 0,
    matureCards: mature.get(deck.id) ?? 0,
  }));
}

export async function getDeck(userId: string, id: string) {
  const deck = await prisma.flashcardDeck.findFirst({
    where: { id, userId },
    include: deckInclude,
  });
  if (!deck) throw new NotFoundError('Deck');
  return deck;
}

async function assertDeckOwned(userId: string, deckId: string): Promise<void> {
  const deck = await prisma.flashcardDeck.findFirst({
    where: { id: deckId, userId },
    select: { id: true },
  });
  if (!deck) throw new NotFoundError('Deck');
}

export async function createDeck(userId: string, input: CreateDeckInput) {
  if (input.subjectId) {
    const subject = await prisma.subject.findFirst({
      where: { id: input.subjectId, userId },
      select: { id: true },
    });
    if (!subject) throw new BadRequestError('That subject does not exist');
  }

  return prisma.flashcardDeck.create({
    data: {
      userId,
      name: input.name,
      description: input.description ?? null,
      color: input.color,
      subjectId: input.subjectId ?? null,
      sourceNoteId: input.sourceNoteId ?? null,
      isPublic: input.isPublic ?? false,
      generatedByAi: input.generatedByAi ?? false,
    },
    include: deckInclude,
  });
}

export async function updateDeck(userId: string, id: string, input: UpdateDeckInput) {
  await assertDeckOwned(userId, id);

  const data: Prisma.FlashcardDeckUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.color !== undefined) data.color = input.color;
  if (input.isPublic !== undefined) data.isPublic = input.isPublic;
  if (input.subjectId !== undefined) {
    data.subject = input.subjectId ? { connect: { id: input.subjectId } } : { disconnect: true };
  }

  return prisma.flashcardDeck.update({ where: { id }, data, include: deckInclude });
}

export async function deleteDeck(userId: string, id: string): Promise<void> {
  const result = await prisma.flashcardDeck.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new NotFoundError('Deck');
}

// --- Cards ------------------------------------------------------------------

export async function listCards(userId: string, deckId: string, query: ListCardsQuery) {
  await assertDeckOwned(userId, deckId);

  const where: Prisma.FlashcardWhereInput = { deckId };

  if (query.difficulty?.length) {
    where.difficulty = { in: query.difficulty as CardDifficulty[] };
  }
  if (query.state?.length) {
    where.state = { in: query.state as Prisma.EnumCardStateFilter['in'] };
  }
  if (query.suspended !== undefined) where.suspended = query.suspended;
  if (query.tags?.length) where.tags = { hasSome: query.tags };

  if (query.search) {
    where.OR = [
      { front: { contains: query.search, mode: 'insensitive' } },
      { back: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const skip = (query.page - 1) * query.limit;

  const [items, total] = await Promise.all([
    prisma.flashcard.findMany({
      where,
      orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }],
      skip,
      take: query.limit,
    }),
    prisma.flashcard.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / query.limit));

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNext: query.page < totalPages,
      hasPrevious: query.page > 1,
    },
  };
}

export async function createCard(userId: string, deckId: string, input: CreateCardInput) {
  await assertDeckOwned(userId, deckId);

  return prisma.flashcard.create({
    data: {
      deckId,
      front: input.front,
      back: input.back,
      hint: input.hint ?? null,
      tags: input.tags ?? [],
      difficulty: input.difficulty,
      generatedByAi: input.generatedByAi ?? false,
      ...initialState(),
      // A new card is due immediately so it enters the next review session.
      dueAt: new Date(),
    },
  });
}

/** Bulk insert used by AI generation and file import. */
export async function createCards(
  userId: string,
  deckId: string,
  cards: CreateCardInput[],
): Promise<number> {
  await assertDeckOwned(userId, deckId);
  if (cards.length === 0) return 0;

  const now = new Date();
  const result = await prisma.flashcard.createMany({
    data: cards.map((card) => ({
      deckId,
      front: card.front,
      back: card.back,
      hint: card.hint ?? null,
      tags: card.tags ?? [],
      difficulty: card.difficulty,
      generatedByAi: card.generatedByAi ?? false,
      ...initialState(),
      dueAt: now,
    })),
  });

  return result.count;
}

export async function updateCard(userId: string, cardId: string, input: UpdateCardInput) {
  const card = await prisma.flashcard.findFirst({
    where: { id: cardId, deck: { userId } },
    select: { id: true },
  });
  if (!card) throw new NotFoundError('Card');

  const data: Prisma.FlashcardUpdateInput = {};
  if (input.front !== undefined) data.front = input.front;
  if (input.back !== undefined) data.back = input.back;
  if (input.hint !== undefined) data.hint = input.hint;
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.difficulty !== undefined) data.difficulty = input.difficulty;
  if (input.suspended !== undefined) data.suspended = input.suspended;

  return prisma.flashcard.update({ where: { id: cardId }, data });
}

export async function deleteCard(userId: string, cardId: string): Promise<void> {
  const result = await prisma.flashcard.deleteMany({
    where: { id: cardId, deck: { userId } },
  });
  if (result.count === 0) throw new NotFoundError('Card');
}

/** Clears scheduling state, returning cards to the new queue. */
export async function resetCards(userId: string, deckId: string): Promise<number> {
  await assertDeckOwned(userId, deckId);

  const result = await prisma.flashcard.updateMany({
    where: { deckId },
    data: { ...initialState(), dueAt: new Date(), lastReviewedAt: null },
  });

  return result.count;
}

// --- Review queue -----------------------------------------------------------

export interface ReviewCard {
  id: string;
  front: string;
  back: string;
  hint: string | null;
  tags: string[];
  difficulty: CardDifficulty;
  state: string;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  /** Interval each rating would produce, so the UI can label its buttons. */
  intervalPreview: Record<ReviewRating, number>;
}

function toSchedulingState(card: {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  state: string;
}): SchedulingState {
  return {
    easeFactor: card.easeFactor,
    intervalDays: card.intervalDays,
    repetitions: card.repetitions,
    lapses: card.lapses,
    state: card.state as SchedulingState['state'],
  };
}

/**
 * Builds the review queue: due cards first (oldest due first), then new cards
 * up to the requested limit. Suspended cards never appear.
 */
export async function getReviewQueue(
  userId: string,
  options: { deckId?: string | undefined; limit: number; newLimit: number },
): Promise<ReviewCard[]> {
  if (options.deckId) await assertDeckOwned(userId, options.deckId);

  const now = new Date();
  const scope: Prisma.FlashcardWhereInput = {
    deck: options.deckId ? { id: options.deckId, userId } : { userId },
    suspended: false,
  };

  const due = await prisma.flashcard.findMany({
    where: { ...scope, dueAt: { lte: now }, state: { not: 'NEW' } },
    orderBy: { dueAt: 'asc' },
    take: options.limit,
  });

  const remaining = Math.max(0, options.limit - due.length);
  const fresh =
    remaining > 0 && options.newLimit > 0
      ? await prisma.flashcard.findMany({
          where: { ...scope, state: 'NEW' },
          orderBy: { createdAt: 'asc' },
          take: Math.min(remaining, options.newLimit),
        })
      : [];

  return [...due, ...fresh].map((card) => ({
    id: card.id,
    front: card.front,
    back: card.back,
    hint: card.hint,
    tags: card.tags,
    difficulty: card.difficulty,
    state: card.state,
    intervalDays: card.intervalDays,
    repetitions: card.repetitions,
    lapses: card.lapses,
    intervalPreview: previewIntervals(toSchedulingState(card), now),
  }));
}

export interface ReviewOutcome {
  cardId: string;
  passed: boolean;
  intervalDays: number;
  dueAt: Date;
  easeFactor: number;
}

/**
 * Records one review: applies SM-2, persists the new schedule, and writes an
 * immutable review row for analytics. Both happen in a transaction so the
 * history can never disagree with the card's state.
 */
export async function reviewCard(
  userId: string,
  cardId: string,
  rating: ReviewRating,
  responseMs?: number,
): Promise<ReviewOutcome> {
  const card = await prisma.flashcard.findFirst({
    where: { id: cardId, deck: { userId } },
  });
  if (!card) throw new NotFoundError('Card');
  if (card.suspended) throw new BadRequestError('This card is suspended');

  const before = toSchedulingState(card);
  const result = schedule(before, RATING_TO_QUALITY[rating]);

  await prisma.$transaction([
    prisma.flashcard.update({
      where: { id: cardId },
      data: {
        easeFactor: result.easeFactor,
        intervalDays: result.intervalDays,
        repetitions: result.repetitions,
        lapses: result.lapses,
        state: result.state,
        dueAt: result.dueAt,
        lastReviewedAt: new Date(),
      },
    }),
    prisma.flashcardReview.create({
      data: {
        cardId,
        userId,
        quality: RATING_TO_QUALITY[rating],
        responseMs: responseMs ?? null,
        easeBefore: before.easeFactor,
        easeAfter: result.easeFactor,
        intervalBefore: before.intervalDays,
        intervalAfter: result.intervalDays,
      },
    }),
  ]);

  emit({ type: 'flashcard.reviewed', userId, count: 1 });

  return {
    cardId,
    passed: result.passed,
    intervalDays: result.intervalDays,
    dueAt: result.dueAt,
    easeFactor: result.easeFactor,
  };
}

// --- Statistics -------------------------------------------------------------

export interface ReviewHeatmapPoint {
  date: string;
  count: number;
}

export interface FlashcardStats {
  totalCards: number;
  dueToday: number;
  newCards: number;
  matureCards: number;
  learningCards: number;
  suspendedCards: number;
  reviewsToday: number;
  reviewsTotal: number;
  /** Share of reviews graded 3+ over the window, as a percentage. */
  retentionRate: number;
  averageEase: number;
  heatmap: ReviewHeatmapPoint[];
  forecast: { date: string; count: number }[];
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function getStats(
  userId: string,
  options: { deckId?: string | undefined; heatmapDays: number; forecastDays: number },
): Promise<FlashcardStats> {
  if (options.deckId) await assertDeckOwned(userId, options.deckId);

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const heatmapStart = new Date(
    todayStart.getTime() - (options.heatmapDays - 1) * 24 * 60 * 60 * 1000,
  );
  const forecastEnd = new Date(
    todayStart.getTime() + options.forecastDays * 24 * 60 * 60 * 1000,
  );

  const cardScope: Prisma.FlashcardWhereInput = {
    deck: options.deckId ? { id: options.deckId, userId } : { userId },
  };
  const reviewScope: Prisma.FlashcardReviewWhereInput = {
    userId,
    ...(options.deckId ? { card: { deckId: options.deckId } } : {}),
  };

  const [
    totalCards,
    dueToday,
    newCards,
    matureCards,
    learningCards,
    suspendedCards,
    reviewsToday,
    reviewsTotal,
    passedReviews,
    windowReviews,
    easeAggregate,
    heatmapRows,
    forecastRows,
  ] = await Promise.all([
    prisma.flashcard.count({ where: cardScope }),
    prisma.flashcard.count({
      where: { ...cardScope, suspended: false, dueAt: { lte: now } },
    }),
    prisma.flashcard.count({ where: { ...cardScope, state: 'NEW' } }),
    prisma.flashcard.count({
      where: { ...cardScope, intervalDays: { gte: MATURE_INTERVAL_DAYS } },
    }),
    prisma.flashcard.count({
      where: { ...cardScope, state: { in: ['LEARNING', 'RELEARNING'] } },
    }),
    prisma.flashcard.count({ where: { ...cardScope, suspended: true } }),
    prisma.flashcardReview.count({
      where: { ...reviewScope, reviewedAt: { gte: todayStart, lt: tomorrowStart } },
    }),
    prisma.flashcardReview.count({ where: reviewScope }),
    prisma.flashcardReview.count({
      where: { ...reviewScope, quality: { gte: 3 }, reviewedAt: { gte: heatmapStart } },
    }),
    prisma.flashcardReview.count({
      where: { ...reviewScope, reviewedAt: { gte: heatmapStart } },
    }),
    prisma.flashcard.aggregate({ where: cardScope, _avg: { easeFactor: true } }),
    prisma.flashcardReview.findMany({
      where: { ...reviewScope, reviewedAt: { gte: heatmapStart } },
      select: { reviewedAt: true },
    }),
    prisma.flashcard.findMany({
      where: {
        ...cardScope,
        suspended: false,
        dueAt: { gte: tomorrowStart, lt: forecastEnd },
      },
      select: { dueAt: true },
    }),
  ]);

  // Bucket by local date, then fill gaps so the heatmap has no holes.
  const heatCounts = new Map<string, number>();
  for (const row of heatmapRows) {
    const key = toDateKey(row.reviewedAt);
    heatCounts.set(key, (heatCounts.get(key) ?? 0) + 1);
  }

  const heatmap: ReviewHeatmapPoint[] = [];
  for (let offset = options.heatmapDays - 1; offset >= 0; offset -= 1) {
    const day = new Date(todayStart.getTime() - offset * 24 * 60 * 60 * 1000);
    const key = toDateKey(day);
    heatmap.push({ date: key, count: heatCounts.get(key) ?? 0 });
  }

  const forecastCounts = new Map<string, number>();
  for (const row of forecastRows) {
    const key = toDateKey(row.dueAt);
    forecastCounts.set(key, (forecastCounts.get(key) ?? 0) + 1);
  }

  const forecast: { date: string; count: number }[] = [];
  for (let offset = 1; offset <= options.forecastDays; offset += 1) {
    const day = new Date(todayStart.getTime() + offset * 24 * 60 * 60 * 1000);
    const key = toDateKey(day);
    forecast.push({ date: key, count: forecastCounts.get(key) ?? 0 });
  }

  return {
    totalCards,
    dueToday,
    newCards,
    matureCards,
    learningCards,
    suspendedCards,
    reviewsToday,
    reviewsTotal,
    retentionRate:
      windowReviews === 0 ? 0 : Math.round((passedReviews / windowReviews) * 100),
    averageEase: Number((easeAggregate._avg.easeFactor ?? 2.5).toFixed(2)),
    heatmap,
    forecast,
  };
}

// --- Import / export --------------------------------------------------------

export interface ExportedDeck {
  name: string;
  description: string | null;
  color: string;
  exportedAt: string;
  cards: {
    front: string;
    back: string;
    hint: string | null;
    tags: string[];
    difficulty: CardDifficulty;
  }[];
}

/**
 * Exports content only — scheduling state is intentionally omitted, since it
 * belongs to one learner's history and is meaningless to an importer.
 */
export async function exportDeck(userId: string, deckId: string): Promise<ExportedDeck> {
  const deck = await getDeck(userId, deckId);

  const cards = await prisma.flashcard.findMany({
    where: { deckId },
    orderBy: { createdAt: 'asc' },
    select: { front: true, back: true, hint: true, tags: true, difficulty: true },
  });

  return {
    name: deck.name,
    description: deck.description,
    color: deck.color,
    exportedAt: new Date().toISOString(),
    cards,
  };
}

/** Serialises a deck as CSV. Fields are quoted and internal quotes doubled. */
export function toCsv(deck: ExportedDeck): string {
  const escape = (value: string): string => `"${value.replace(/"/g, '""')}"`;

  const rows = [
    ['front', 'back', 'hint', 'tags', 'difficulty'].join(','),
    ...deck.cards.map((card) =>
      [
        escape(card.front),
        escape(card.back),
        escape(card.hint ?? ''),
        escape(card.tags.join(';')),
        escape(card.difficulty),
      ].join(','),
    ),
  ];

  return rows.join('\r\n');
}

/**
 * Parses CSV produced by {@link toCsv}, tolerating quoted fields containing
 * commas, newlines and escaped quotes. A header row is required.
 */
export function parseCsv(input: string): {
  front: string;
  back: string;
  hint: string | null;
  tags: string[];
}[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char as string;
    }
  }

  // Flush a trailing field/row when the input has no final newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  if (!header) return [];

  const columns = header.map((name) => name.trim().toLowerCase());
  const frontIndex = columns.indexOf('front');
  const backIndex = columns.indexOf('back');
  const hintIndex = columns.indexOf('hint');
  const tagsIndex = columns.indexOf('tags');

  if (frontIndex === -1 || backIndex === -1) {
    throw new BadRequestError('CSV must include "front" and "back" columns');
  }

  return body
    .filter((entry) => entry.some((value) => value.trim() !== ''))
    .map((entry) => {
      const hint = hintIndex === -1 ? '' : (entry[hintIndex] ?? '');
      const tags = tagsIndex === -1 ? '' : (entry[tagsIndex] ?? '');
      return {
        front: (entry[frontIndex] ?? '').trim(),
        back: (entry[backIndex] ?? '').trim(),
        hint: hint.trim() === '' ? null : hint.trim(),
        tags: tags
          .split(';')
          .map((tag) => tag.trim())
          .filter(Boolean),
      };
    })
    .filter((card) => card.front !== '' && card.back !== '');
}

export const flashcardService = {
  listDecks,
  getDeck,
  createDeck,
  updateDeck,
  deleteDeck,
  listCards,
  createCard,
  createCards,
  updateCard,
  deleteCard,
  resetCards,
  getReviewQueue,
  reviewCard,
  getStats,
  exportDeck,
  toCsv,
  parseCsv,
} as const;
