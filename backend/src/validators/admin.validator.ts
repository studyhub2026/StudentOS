import { z } from 'zod';

const cuid = z.string().min(1);

export const listUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.enum(['createdAt', 'lastActiveDate', 'name', 'email', 'totalXp']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),

  role: z.enum(['STUDENT', 'TEACHER', 'ADMIN']).optional(),
  status: z.enum(['active', 'suspended', 'unverified']).optional(),
  search: z.string().trim().max(200).optional(),
});

export const changeRoleSchema = z.object({
  role: z.enum(['STUDENT', 'TEACHER', 'ADMIN']),
});

export const suspendUserSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const overviewSchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
});

export const listLogsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().trim().max(120).optional(),
  userId: cuid.optional(),
});

export const listMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  groupId: cuid.optional(),
});

export const listGroupsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().max(120).optional(),
});

export const moderateMessageSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const userIdSchema = z.object({ id: cuid });
export const messageIdSchema = z.object({ messageId: cuid });

export type ListUsersQuery = z.infer<typeof listUsersSchema>;
