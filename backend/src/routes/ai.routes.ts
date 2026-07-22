import { Router } from 'express';
import * as controller from '../controllers/ai.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { aiRateLimit } from '../middlewares/rate-limit.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  coachSchema,
  conversationIdSchema,
  createConversationSchema,
  explainConceptSchema,
  generateExamSchema,
  learningPathSchema,
  listConversationsSchema,
  quizSchema,
  renameConversationSchema,
  revisionSheetSchema,
  sendMessageSchema,
  summariseSchema,
} from '../validators/ai.validator.js';

export const aiRouter: Router = Router();

aiRouter.use(requireAuth);

// Availability check is deliberately outside the AI rate limit — the UI polls
// it to decide whether to render AI affordances at all.
aiRouter.get('/status', controller.status);

// --- Conversations ----------------------------------------------------------

aiRouter.get(
  '/conversations',
  validate({ query: listConversationsSchema }),
  asyncHandler(controller.listConversations),
);

aiRouter.post(
  '/conversations',
  validate({ body: createConversationSchema }),
  asyncHandler(controller.createConversation),
);

aiRouter.get(
  '/conversations/:id',
  validate({ params: conversationIdSchema }),
  asyncHandler(controller.getConversation),
);

aiRouter.patch(
  '/conversations/:id',
  validate({ params: conversationIdSchema, body: renameConversationSchema }),
  asyncHandler(controller.renameConversation),
);

aiRouter.delete(
  '/conversations/:id',
  validate({ params: conversationIdSchema }),
  asyncHandler(controller.deleteConversation),
);

// --- Chat -------------------------------------------------------------------

aiRouter.post(
  '/chat',
  aiRateLimit,
  validate({ body: sendMessageSchema }),
  asyncHandler(controller.sendMessage),
);

aiRouter.post(
  '/chat/stream',
  aiRateLimit,
  validate({ body: sendMessageSchema }),
  asyncHandler(controller.streamMessage),
);

// --- Structured generators --------------------------------------------------

aiRouter.post(
  '/exam',
  aiRateLimit,
  validate({ body: generateExamSchema }),
  asyncHandler(controller.generateExam),
);

aiRouter.post(
  '/explain',
  aiRateLimit,
  validate({ body: explainConceptSchema }),
  asyncHandler(controller.explainConcept),
);

aiRouter.post(
  '/learning-path',
  aiRateLimit,
  validate({ body: learningPathSchema }),
  asyncHandler(controller.learningPath),
);

aiRouter.post(
  '/revision',
  aiRateLimit,
  validate({ body: revisionSheetSchema }),
  asyncHandler(controller.revisionSheet),
);

aiRouter.post(
  '/coach',
  aiRateLimit,
  validate({ body: coachSchema }),
  asyncHandler(controller.coach),
);

aiRouter.post(
  '/quiz',
  aiRateLimit,
  validate({ body: quizSchema }),
  asyncHandler(controller.generateQuiz),
);

aiRouter.post(
  '/summarise',
  aiRateLimit,
  validate({ body: summariseSchema }),
  asyncHandler(controller.summarise),
);
