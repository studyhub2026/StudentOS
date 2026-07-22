import { z } from 'zod';

const cuid = z.string().min(1);

export const createGroupSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  description: z.string().trim().max(1000).optional().nullable(),
  isPublic: z.boolean().optional(),
  maxMembers: z.coerce.number().int().min(2).max(500).optional(),
});

export const updateGroupSchema = createGroupSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const createChannelSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens only'),
  type: z.enum(['TEXT', 'ANNOUNCEMENT']).default('TEXT'),
  topic: z.string().trim().max(200).optional().nullable(),
});

export const joinGroupSchema = z.object({
  inviteCode: z.string().trim().min(4, 'Enter an invite code').max(32),
});

export const memberRoleSchema = z.object({
  role: z.enum(['MODERATOR', 'MEMBER']),
});

export const listMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Message id to page backwards from. */
  before: cuid.optional(),
});

export const editMessageSchema = z.object({
  content: z.string().trim().min(1, 'Message cannot be empty').max(4000),
});

export const discoverSchema = z.object({
  search: z.string().trim().max(120).optional(),
});

export const groupIdSchema = z.object({ id: cuid });
export const groupChannelSchema = z.object({ id: cuid, channelId: cuid });
export const groupMemberSchema = z.object({ id: cuid, userId: cuid });
export const groupMessageSchema = z.object({ id: cuid, messageId: cuid });

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
export type CreateChannelInput = z.infer<typeof createChannelSchema>;
