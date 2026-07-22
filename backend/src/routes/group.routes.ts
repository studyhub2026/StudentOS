import { Router } from 'express';
import * as controller from '../controllers/group.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  createChannelSchema,
  createGroupSchema,
  discoverSchema,
  editMessageSchema,
  groupChannelSchema,
  groupIdSchema,
  groupMemberSchema,
  groupMessageSchema,
  joinGroupSchema,
  listMessagesSchema,
  memberRoleSchema,
  updateGroupSchema,
} from '../validators/group.validator.js';

export const groupRouter: Router = Router();

groupRouter.use(requireAuth);

// Static segments before '/:id'.
groupRouter.get('/discover', validate({ query: discoverSchema }), asyncHandler(controller.discover));
groupRouter.post('/join', validate({ body: joinGroupSchema }), asyncHandler(controller.join));

groupRouter.get('/', asyncHandler(controller.list));
groupRouter.post('/', validate({ body: createGroupSchema }), asyncHandler(controller.create));

groupRouter.get('/:id', validate({ params: groupIdSchema }), asyncHandler(controller.getById));

groupRouter.patch(
  '/:id',
  validate({ params: groupIdSchema, body: updateGroupSchema }),
  asyncHandler(controller.update),
);

groupRouter.delete('/:id', validate({ params: groupIdSchema }), asyncHandler(controller.remove));

groupRouter.post(
  '/:id/invite',
  validate({ params: groupIdSchema }),
  asyncHandler(controller.regenerateInvite),
);

groupRouter.post('/:id/leave', validate({ params: groupIdSchema }), asyncHandler(controller.leave));

// --- Members ----------------------------------------------------------------

groupRouter.delete(
  '/:id/members/:userId',
  validate({ params: groupMemberSchema }),
  asyncHandler(controller.removeMember),
);

groupRouter.patch(
  '/:id/members/:userId/role',
  validate({ params: groupMemberSchema, body: memberRoleSchema }),
  asyncHandler(controller.changeRole),
);

groupRouter.post(
  '/:id/members/:userId/transfer-ownership',
  validate({ params: groupMemberSchema }),
  asyncHandler(controller.transferOwnership),
);

// --- Channels ---------------------------------------------------------------

groupRouter.post(
  '/:id/channels',
  validate({ params: groupIdSchema, body: createChannelSchema }),
  asyncHandler(controller.createChannel),
);

groupRouter.delete(
  '/:id/channels/:channelId',
  validate({ params: groupChannelSchema }),
  asyncHandler(controller.removeChannel),
);

groupRouter.get(
  '/:id/channels/:channelId/messages',
  validate({ params: groupChannelSchema, query: listMessagesSchema }),
  asyncHandler(controller.listMessages),
);

// --- Messages ---------------------------------------------------------------

groupRouter.patch(
  '/:id/messages/:messageId',
  validate({ params: groupMessageSchema, body: editMessageSchema }),
  asyncHandler(controller.editMessage),
);

groupRouter.delete(
  '/:id/messages/:messageId',
  validate({ params: groupMessageSchema }),
  asyncHandler(controller.deleteMessage),
);
