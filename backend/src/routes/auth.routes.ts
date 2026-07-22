import { Router } from 'express';
import { z } from 'zod';
import * as controller from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { authRateLimit } from '../middlewares/rate-limit.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  changePasswordSchema,
  disable2faSchema,
  forgotPasswordSchema,
  loginSchema,
  oauthProviderSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  sessionIdSchema,
  verifyEmailSchema,
} from '../validators/auth.validator.js';

export const authRouter: Router = Router();

// --- Public -----------------------------------------------------------------
// Credential endpoints carry the strict rate limit to blunt brute-force and
// enumeration attempts.

authRouter.post(
  '/register',
  authRateLimit,
  validate({ body: registerSchema }),
  asyncHandler(controller.register),
);

authRouter.post(
  '/login',
  authRateLimit,
  validate({ body: loginSchema }),
  asyncHandler(controller.login),
);

authRouter.post(
  '/refresh',
  validate({ body: refreshSchema }),
  asyncHandler(controller.refresh),
);

authRouter.post(
  '/verify-email',
  validate({ body: verifyEmailSchema }),
  asyncHandler(controller.verifyEmail),
);

authRouter.post(
  '/forgot-password',
  authRateLimit,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(controller.forgotPassword),
);

authRouter.post(
  '/reset-password',
  authRateLimit,
  validate({ body: resetPasswordSchema }),
  asyncHandler(controller.resetPassword),
);

// --- OAuth ------------------------------------------------------------------

authRouter.get('/oauth/providers', controller.listOAuthProviders);

authRouter.get(
  '/oauth/:provider',
  validate({ params: oauthProviderSchema }),
  controller.oauthRedirect,
);

authRouter.get(
  '/oauth/:provider/callback',
  validate({ params: oauthProviderSchema }),
  asyncHandler(controller.oauthCallback),
);

// --- Authenticated ----------------------------------------------------------

authRouter.use(requireAuth);

authRouter.get('/me', asyncHandler(controller.me));
authRouter.post('/logout', asyncHandler(controller.logout));
authRouter.post('/resend-verification', authRateLimit, asyncHandler(controller.resendVerification));

authRouter.post(
  '/change-password',
  validate({ body: changePasswordSchema }),
  asyncHandler(controller.changePassword),
);

authRouter.post('/2fa/setup', asyncHandler(controller.setup2fa));

authRouter.post(
  '/2fa/enable',
  validate({
    body: z.object({
      secret: z.string().min(1, 'Enrolment secret is required'),
      totp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
    }),
  }),
  asyncHandler(controller.enable2fa),
);

authRouter.post(
  '/2fa/disable',
  validate({ body: disable2faSchema }),
  asyncHandler(controller.disable2fa),
);

authRouter.get('/sessions', asyncHandler(controller.listSessions));
authRouter.delete('/sessions/others', asyncHandler(controller.revokeOtherSessions));

authRouter.delete(
  '/sessions/:id',
  validate({ params: sessionIdSchema }),
  asyncHandler(controller.revokeSession),
);

authRouter.delete(
  '/oauth/:provider',
  validate({ params: oauthProviderSchema }),
  asyncHandler(controller.unlinkProvider),
);
