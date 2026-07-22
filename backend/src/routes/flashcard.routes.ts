import { Router } from 'express';
import * as controller from '../controllers/flashcard.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { aiRateLimit } from '../middlewares/rate-limit.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  bulkCreateCardsSchema,
  cardIdSchema,
  createCardSchema,
  createDeckSchema,
  deckCardParamsSchema,
  deckIdSchema,
  generateCardsSchema,
  importDeckSchema,
  listCardsSchema,
  reviewCardSchema,
  reviewQueueSchema,
  statsQuerySchema,
  updateCardSchema,
  updateDeckSchema,
} from '../validators/flashcard.validator.js';

export const flashcardRouter: Router = Router();

flashcardRouter.use(requireAuth);

// Static segments first, so "queue"/"stats"/"import" are not read as deck ids.
flashcardRouter.get(
  '/queue',
  validate({ query: reviewQueueSchema }),
  asyncHandler(controller.reviewQueue),
);

flashcardRouter.get(
  '/stats',
  validate({ query: statsQuerySchema }),
  asyncHandler(controller.stats),
);

flashcardRouter.post(
  '/import',
  validate({ body: importDeckSchema }),
  asyncHandler(controller.importDeck),
);

// Reviewing is card-scoped rather than deck-scoped, since a queue may mix
// cards from several decks.
flashcardRouter.post(
  '/cards/:cardId/review',
  validate({ params: cardIdSchema, body: reviewCardSchema }),
  asyncHandler(controller.reviewCard),
);

flashcardRouter.patch(
  '/cards/:cardId',
  validate({ params: cardIdSchema, body: updateCardSchema }),
  asyncHandler(controller.updateCard),
);

flashcardRouter.delete(
  '/cards/:cardId',
  validate({ params: cardIdSchema }),
  asyncHandler(controller.removeCard),
);

// --- Decks ------------------------------------------------------------------

flashcardRouter.get('/', asyncHandler(controller.listDecks));
flashcardRouter.post('/', validate({ body: createDeckSchema }), asyncHandler(controller.createDeck));

flashcardRouter.get('/:id', validate({ params: deckIdSchema }), asyncHandler(controller.getDeck));

flashcardRouter.patch(
  '/:id',
  validate({ params: deckIdSchema, body: updateDeckSchema }),
  asyncHandler(controller.updateDeck),
);

flashcardRouter.delete(
  '/:id',
  validate({ params: deckIdSchema }),
  asyncHandler(controller.removeDeck),
);

flashcardRouter.post(
  '/:id/reset',
  validate({ params: deckIdSchema }),
  asyncHandler(controller.resetDeck),
);

flashcardRouter.get('/:id/export', validate({ params: deckIdSchema }), asyncHandler(controller.exportDeck));

// --- Cards within a deck ----------------------------------------------------

flashcardRouter.get(
  '/:id/cards',
  validate({ params: deckIdSchema, query: listCardsSchema }),
  asyncHandler(controller.listCards),
);

flashcardRouter.post(
  '/:id/cards',
  validate({ params: deckIdSchema, body: createCardSchema }),
  asyncHandler(controller.createCard),
);

flashcardRouter.post(
  '/:id/cards/bulk',
  validate({ params: deckIdSchema, body: bulkCreateCardsSchema }),
  asyncHandler(controller.bulkCreateCards),
);

// --- AI ---------------------------------------------------------------------

flashcardRouter.post(
  '/:id/generate',
  aiRateLimit,
  validate({ params: deckIdSchema, body: generateCardsSchema }),
  asyncHandler(controller.generateCards),
);

export { deckCardParamsSchema };
