import { Router } from 'express';
import * as controller from '../controllers/schedule.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { aiRateLimit } from '../middlewares/rate-limit.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  analyticsQuerySchema,
  applyPlanSchema,
  blockIdSchema,
  createBlockSchema,
  endSessionSchema,
  generatePlanSchema,
  listBlocksSchema,
  listSessionsSchema,
  sessionIdSchema,
  startSessionSchema,
  updateBlockSchema,
  weekQuerySchema,
} from '../validators/schedule.validator.js';

// --- Timetable --------------------------------------------------------------

export const scheduleRouter: Router = Router();

scheduleRouter.use(requireAuth);

scheduleRouter.get('/week', validate({ query: weekQuerySchema }), asyncHandler(controller.getWeek));

scheduleRouter.get(
  '/',
  validate({ query: listBlocksSchema }),
  asyncHandler(controller.listBlocks),
);

scheduleRouter.post(
  '/',
  validate({ body: createBlockSchema }),
  asyncHandler(controller.createBlock),
);

scheduleRouter.patch(
  '/:id',
  validate({ params: blockIdSchema, body: updateBlockSchema }),
  asyncHandler(controller.updateBlock),
);

scheduleRouter.delete(
  '/:id',
  validate({ params: blockIdSchema }),
  asyncHandler(controller.removeBlock),
);

// --- Planner ----------------------------------------------------------------

export const plannerRouter: Router = Router();

plannerRouter.use(requireAuth);

plannerRouter.post(
  '/generate',
  aiRateLimit,
  validate({ body: generatePlanSchema }),
  asyncHandler(controller.generatePlan),
);

plannerRouter.post(
  '/apply',
  validate({ body: applyPlanSchema }),
  asyncHandler(controller.applyPlan),
);

// --- Focus ------------------------------------------------------------------

export const focusRouter: Router = Router();

focusRouter.use(requireAuth);

focusRouter.get('/active', asyncHandler(controller.activeSession));

focusRouter.get(
  '/sessions',
  validate({ query: listSessionsSchema }),
  asyncHandler(controller.listSessions),
);

focusRouter.post(
  '/start',
  validate({ body: startSessionSchema }),
  asyncHandler(controller.startSession),
);

focusRouter.post(
  '/:id/end',
  validate({ params: sessionIdSchema, body: endSessionSchema }),
  asyncHandler(controller.endSession),
);

focusRouter.delete(
  '/:id',
  validate({ params: sessionIdSchema }),
  asyncHandler(controller.cancelSession),
);

// --- Analytics --------------------------------------------------------------

export const analyticsRouter: Router = Router();

analyticsRouter.use(requireAuth);

analyticsRouter.get(
  '/',
  validate({ query: analyticsQuerySchema }),
  asyncHandler(controller.analytics),
);
