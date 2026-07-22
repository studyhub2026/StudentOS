import { z } from 'zod';

/**
 * Password policy: length is the dominant factor in resistance to offline
 * cracking, so the floor is 10 rather than the more common 8, with a mixed
 * character requirement to rule out trivially guessable strings.
 */
const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((value) => /[a-z]/.test(value), 'Password must contain a lowercase letter')
  .refine((value) => /[A-Z]/.test(value), 'Password must contain an uppercase letter')
  .refine((value) => /[0-9]/.test(value), 'Password must contain a number');

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(30, 'Username must be at most 30 characters')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Username may only contain letters, numbers, hyphens and underscores',
  );

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  name: z.string().trim().min(1, 'Name is required').max(80),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
  // Present only when the account has 2FA enabled.
  totp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code')
    .optional(),
  rememberMe: z.boolean().optional().default(false),
});

export const refreshSchema = z.object({
  // Optional in the body — the refresh token is normally read from the
  // httpOnly cookie, with the body accepted as a fallback for native clients.
  refreshToken: z.string().min(1).optional(),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

export const enable2faSchema = z.object({
  totp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const disable2faSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  totp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const oauthProviderSchema = z.object({
  provider: z.enum(['google', 'github', 'discord']),
});

export const oauthCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().min(1, 'State is required'),
});

export const sessionIdSchema = z.object({
  id: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type OAuthProviderInput = z.infer<typeof oauthProviderSchema>;
