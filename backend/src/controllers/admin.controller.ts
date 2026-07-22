import type { Role } from '@prisma/client';
import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { adminService } from '../services/admin.service.js';
import { oauthService } from '../services/oauth.service.js';
import { uploadService } from '../services/upload.service.js';
import { UnauthorizedError } from '../utils/errors.js';
import type { ListUsersQuery } from '../validators/admin.validator.js';

function actorId(req: Request): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}

export async function overview(req: Request, res: Response): Promise<void> {
  const { days } = req.query as unknown as { days: number };
  res.json({ success: true, data: await adminService.getOverview(days) });
}

export async function listUsers(req: Request, res: Response): Promise<void> {
  const result = await adminService.listUsers(req.query as unknown as ListUsersQuery);
  res.json({ success: true, data: result.items, pagination: result.pagination });
}

export async function getUser(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await adminService.getUser(req.params.id as string) });
}

export async function changeRole(req: Request, res: Response): Promise<void> {
  const { role } = req.body as { role: Role };
  await adminService.changeRole(actorId(req), req.params.id as string, role);
  res.json({ success: true, data: { message: `Role changed to ${role}` } });
}

export async function suspendUser(req: Request, res: Response): Promise<void> {
  const { reason } = req.body as { reason?: string };
  await adminService.suspendUser(actorId(req), req.params.id as string, reason);
  res.json({ success: true, data: { message: 'Account suspended' } });
}

export async function reinstateUser(req: Request, res: Response): Promise<void> {
  await adminService.reinstateUser(actorId(req), req.params.id as string);
  res.json({ success: true, data: { message: 'Account reinstated' } });
}

export async function revokeSessions(req: Request, res: Response): Promise<void> {
  const revoked = await adminService.revokeUserSessions(actorId(req), req.params.id as string);
  res.json({ success: true, data: { revoked } });
}

export async function listMessages(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as { limit: number; groupId?: string };
  res.json({ success: true, data: await adminService.listRecentMessages(query) });
}

export async function moderateMessage(req: Request, res: Response): Promise<void> {
  const { reason } = req.body as { reason?: string };
  await adminService.moderateMessage(actorId(req), req.params.messageId as string, reason);
  res.json({ success: true, data: { message: 'Message removed' } });
}

export async function listGroups(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as { limit: number; search?: string };
  res.json({ success: true, data: await adminService.listGroups(query) });
}

export async function listLogs(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as {
    page: number;
    limit: number;
    action?: string;
    userId?: string;
  };
  const result = await adminService.listActivityLogs(query);
  res.json({ success: true, data: result.items, pagination: result.pagination });
}

export async function health(_req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    data: await adminService.getSystemHealth({
      gemini: env.hasGemini,
      cloudinary: uploadService.isConfigured(),
      redis: env.hasRedis,
      oauth: oauthService.listConfiguredProviders(),
      environment: env.NODE_ENV,
    }),
  });
}
