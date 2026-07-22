import { Router } from 'express';
import * as controller from '../controllers/assignment.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  assignmentIdSchema,
  bulkUpdateSchema,
  createAssignmentSchema,
  createSubjectSchema,
  listAssignmentsSchema,
  subjectIdSchema,
  updateAssignmentSchema,
  updateSubjectSchema,
} from '../validators/assignment.validator.js';

export const assignmentRouter: Router = Router();

assignmentRouter.use(requireAuth);

// Static paths must precede `/:id`, or "stats" would be read as an id.
assignmentRouter.get('/stats', asyncHandler(controller.stats));
assignmentRouter.get('/labels', asyncHandler(controller.labels));

assignmentRouter.get(
  '/',
  validate({ query: listAssignmentsSchema }),
  asyncHandler(controller.list),
);

assignmentRouter.post(
  '/',
  validate({ body: createAssignmentSchema }),
  asyncHandler(controller.create),
);

assignmentRouter.patch(
  '/bulk',
  validate({ body: bulkUpdateSchema }),
  asyncHandler(controller.bulkUpdate),
);

assignmentRouter.get(
  '/:id',
  validate({ params: assignmentIdSchema }),
  asyncHandler(controller.getById),
);

assignmentRouter.patch(
  '/:id',
  validate({ params: assignmentIdSchema, body: updateAssignmentSchema }),
  asyncHandler(controller.update),
);

assignmentRouter.delete(
  '/:id',
  validate({ params: assignmentIdSchema }),
  asyncHandler(controller.remove),
);

assignmentRouter.post(
  '/:id/restore',
  validate({ params: assignmentIdSchema }),
  asyncHandler(controller.restore),
);

// --- Subjects ---------------------------------------------------------------

export const subjectRouter: Router = Router();

subjectRouter.use(requireAuth);

subjectRouter.get('/', asyncHandler(controller.listSubjects));

subjectRouter.post(
  '/',
  validate({ body: createSubjectSchema }),
  asyncHandler(controller.createSubject),
);

subjectRouter.patch(
  '/:id',
  validate({ params: subjectIdSchema, body: updateSubjectSchema }),
  asyncHandler(controller.updateSubject),
);

subjectRouter.delete(
  '/:id',
  validate({ params: subjectIdSchema }),
  asyncHandler(controller.removeSubject),
);

// --- Dashboard --------------------------------------------------------------

export const dashboardRouter: Router = Router();

dashboardRouter.use(requireAuth);
dashboardRouter.get('/overview', asyncHandler(controller.overview));
