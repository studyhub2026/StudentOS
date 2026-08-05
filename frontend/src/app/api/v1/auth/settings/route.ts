import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';

const bodySchema = z.object({
  profilePublic: z.boolean().optional(),
  bio: z.string().max(280).optional().nullable(),
  emailNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
});

/**
 * Reads the authenticated user's settings. Kept intentionally small — the
 * bulk of settings (theme, pomodoro cadence, ai model) is already fetched by
 * the pages that need it; this endpoint powers the settings screen and the
 * public-profile toggle only.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const [settings, profile] = await Promise.all([
    prisma.userSettings.findUnique({
      where: { userId: user.id },
      select: {
        profilePublic: true,
        emailNotifications: true,
        pushNotifications: true,
      },
    }),
    prisma.user.findUnique({ where: { id: user.id }, select: { bio: true } }),
  ]);
  return ok({
    profilePublic: settings?.profilePublic ?? false,
    emailNotifications: settings?.emailNotifications ?? true,
    pushNotifications: settings?.pushNotifications ?? true,
    bio: profile?.bio ?? null,
  });
});

export const PATCH = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const body = await readJson(req, bodySchema);

  // Bio lives on User; the rest lives on UserSettings. Do both in one txn so
  // the settings screen never observes a half-applied state.
  const settingsFields: Record<string, unknown> = {};
  if (typeof body.profilePublic === 'boolean') settingsFields.profilePublic = body.profilePublic;
  if (typeof body.emailNotifications === 'boolean') settingsFields.emailNotifications = body.emailNotifications;
  if (typeof body.pushNotifications === 'boolean') settingsFields.pushNotifications = body.pushNotifications;

  const [settings, profile] = await prisma.$transaction([
    Object.keys(settingsFields).length > 0
      ? prisma.userSettings.upsert({
          where: { userId: user.id },
          create: { userId: user.id, ...settingsFields },
          update: settingsFields,
          select: {
            profilePublic: true,
            emailNotifications: true,
            pushNotifications: true,
          },
        })
      : prisma.userSettings.findUnique({
          where: { userId: user.id },
          select: {
            profilePublic: true,
            emailNotifications: true,
            pushNotifications: true,
          },
        }),
    body.bio !== undefined
      ? prisma.user.update({
          where: { id: user.id },
          data: { bio: body.bio },
          select: { bio: true },
        })
      : prisma.user.findUnique({ where: { id: user.id }, select: { bio: true } }),
  ]);

  return ok({
    profilePublic: settings?.profilePublic ?? false,
    emailNotifications: settings?.emailNotifications ?? true,
    pushNotifications: settings?.pushNotifications ?? true,
    bio: profile?.bio ?? null,
  });
});
