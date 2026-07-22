import { Router } from 'express';
import * as controller from '../controllers/upload.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  fileIdSchema,
  registerUploadSchema,
  signUploadSchema,
} from '../validators/upload.validator.js';

export const uploadRouter: Router = Router();

uploadRouter.use(requireAuth);

uploadRouter.get('/status', controller.status);
uploadRouter.get('/', asyncHandler(controller.list));

uploadRouter.post('/sign', validate({ body: signUploadSchema }), controller.sign);

uploadRouter.post(
  '/register',
  validate({ body: registerUploadSchema }),
  asyncHandler(controller.register),
);

uploadRouter.post(
  '/avatar',
  validate({ body: registerUploadSchema }),
  asyncHandler(controller.setAvatar),
);

uploadRouter.delete('/:id', validate({ params: fileIdSchema }), asyncHandler(controller.remove));
