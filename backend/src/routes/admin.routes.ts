import { Role } from '@prisma/client';
import { Router } from 'express';
import * as controller from '../controllers/admin.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  changeRoleSchema,
  listGroupsSchema,
  listLogsSchema,
  listMessagesSchema,
  listUsersSchema,
  messageIdSchema,
  moderateMessageSchema,
  overviewSchema,
  suspendUserSchema,
  userIdSchema,
} from '../validators/admin.validator.js';

export const adminRouter: Router = Router();

// Both guards are required: requireRole reads req.user, which requireAuth sets.
adminRouter.use(requireAuth, requireRole(Role.ADMIN));

adminRouter.get('/overview', validate({ query: overviewSchema }), asyncHandler(controller.overview));
adminRouter.get('/health', asyncHandler(controller.health));

// --- Users ------------------------------------------------------------------

adminRouter.get('/users', validate({ query: listUsersSchema }), asyncHandler(controller.listUsers));
adminRouter.get('/users/:id', validate({ params: userIdSchema }), asyncHandler(controller.getUser));

adminRouter.patch(
  '/users/:id/role',
  validate({ params: userIdSchema, body: changeRoleSchema }),
  asyncHandler(controller.changeRole),
);

adminRouter.post(
  '/users/:id/suspend',
  validate({ params: userIdSchema, body: suspendUserSchema }),
  asyncHandler(controller.suspendUser),
);

adminRouter.post(
  '/users/:id/reinstate',
  validate({ params: userIdSchema }),
  asyncHandler(controller.reinstateUser),
);

adminRouter.post(
  '/users/:id/revoke-sessions',
  validate({ params: userIdSchema }),
  asyncHandler(controller.revokeSessions),
);

// --- Moderation -------------------------------------------------------------

adminRouter.get(
  '/messages',
  validate({ query: listMessagesSchema }),
  asyncHandler(controller.listMessages),
);

adminRouter.delete(
  '/messages/:messageId',
  validate({ params: messageIdSchema, body: moderateMessageSchema }),
  asyncHandler(controller.moderateMessage),
);

adminRouter.get(
  '/groups',
  validate({ query: listGroupsSchema }),
  asyncHandler(controller.listGroups),
);

// --- Audit log --------------------------------------------------------------

adminRouter.get('/logs', validate({ query: listLogsSchema }), asyncHandler(controller.listLogs));
