import 'server-only';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '@/server/db';
import { BadRequestError, ForbiddenError, NotFoundError } from '@/server/lib/errors';
import type { ListUsersQuery } from '@/server/validators/admin.validator';

/**
 * Administrative operations.
 *
 * Every function here is reachable only behind `requireRole(ADMIN)`. Actions
 * that affect another account are recorded in the activity log, so privileged
 * changes are always attributable.
 */

export interface PlatformOverview {
  users: {
    total: number;
    active7d: number;
    active30d: number;
    newThisWeek: number;
    byRole: Record<string, number>;
    verified: number;
    withTwoFactor: number;
    suspended: number;
  };
  content: {
    assignments: number;
    notes: number;
    decks: number;
    flashcards: number;
    studyGroups: number;
    messages: number;
    aiConversations: number;
  };
  activity: {
    studyHours30d: number;
    sessions30d: number;
    reviews30d: number;
    aiMessages30d: number;
  };
  signups: { date: string; count: number }[];
  topSubjects: { name: string; count: number }[];
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function getOverview(days = 30): Promise<PlatformOverview> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const since7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const signupWindow = new Date(todayStart.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  const [
    total,
    active7d,
    active30d,
    newThisWeek,
    byRole,
    verified,
    withTwoFactor,
    suspended,
    assignments,
    notes,
    decks,
    flashcards,
    studyGroups,
    messages,
    aiConversations,
    sessionAgg,
    reviews30d,
    aiMessages30d,
    recentSignups,
    subjectGroups,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, lastActiveDate: { gte: since7 } } }),
    prisma.user.count({ where: { deletedAt: null, lastActiveDate: { gte: since30 } } }),
    prisma.user.count({ where: { deletedAt: null, createdAt: { gte: since7 } } }),
    prisma.user.groupBy({ by: ['role'], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.user.count({ where: { deletedAt: null, emailVerified: true } }),
    prisma.user.count({ where: { deletedAt: null, twoFactorEnabled: true } }),
    prisma.user.count({ where: { deletedAt: { not: null } } }),

    prisma.assignment.count({ where: { deletedAt: null } }),
    prisma.note.count({ where: { deletedAt: null } }),
    prisma.flashcardDeck.count(),
    prisma.flashcard.count(),
    prisma.studyGroup.count(),
    prisma.message.count({ where: { deletedAt: null } }),
    prisma.aiConversation.count({ where: { deletedAt: null } }),

    prisma.studySession.aggregate({
      where: { startedAt: { gte: since30 }, endedAt: { not: null } },
      _sum: { durationSeconds: true },
      _count: { _all: true },
    }),
    prisma.flashcardReview.count({ where: { reviewedAt: { gte: since30 } } }),
    prisma.aiMessage.count({ where: { createdAt: { gte: since30 } } }),

    prisma.user.findMany({
      where: { createdAt: { gte: signupWindow } },
      select: { createdAt: true },
    }),
    prisma.subject.groupBy({
      by: ['name'],
      _count: { _all: true },
      orderBy: { _count: { name: 'desc' } },
      take: 8,
    }),
  ]);

  // Gap-fill the signup series so the chart has a continuous axis.
  const signupCounts = new Map<string, number>();
  for (const row of recentSignups) {
    const key = toDateKey(row.createdAt);
    signupCounts.set(key, (signupCounts.get(key) ?? 0) + 1);
  }

  const signups: { date: string; count: number }[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(todayStart.getTime() - offset * 24 * 60 * 60 * 1000);
    const key = toDateKey(day);
    signups.push({ date: key, count: signupCounts.get(key) ?? 0 });
  }

  return {
    users: {
      total,
      active7d,
      active30d,
      newThisWeek,
      byRole: Object.fromEntries(byRole.map((row) => [row.role, row._count._all])),
      verified,
      withTwoFactor,
      suspended,
    },
    content: {
      assignments,
      notes,
      decks,
      flashcards,
      studyGroups,
      messages,
      aiConversations,
    },
    activity: {
      studyHours30d: Math.round((sessionAgg._sum.durationSeconds ?? 0) / 3600),
      sessions30d: sessionAgg._count._all,
      reviews30d,
      aiMessages30d,
    },
    signups,
    topSubjects: subjectGroups.map((row) => ({ name: row.name, count: row._count._all })),
  };
}

// --- User management --------------------------------------------------------

export async function listUsers(query: ListUsersQuery) {
  const where: Prisma.UserWhereInput = {};

  if (query.role) where.role = query.role;
  if (query.status === 'active') where.deletedAt = null;
  if (query.status === 'suspended') where.deletedAt = { not: null };
  if (query.status === 'unverified') {
    where.deletedAt = null;
    where.emailVerified = false;
  }

  if (query.search) {
    where.OR = [
      { email: { contains: query.search, mode: 'insensitive' } },
      { username: { contains: query.search, mode: 'insensitive' } },
      { name: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const skip = (query.page - 1) * query.limit;

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip,
      take: query.limit,
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        avatarUrl: true,
        role: true,
        emailVerified: true,
        twoFactorEnabled: true,
        currentStreak: true,
        totalXp: true,
        createdAt: true,
        lastActiveDate: true,
        deletedAt: true,
        _count: {
          select: { assignments: true, notes: true, decks: true, studySessions: true },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / query.limit));

  return {
    items: items.map(({ _count, ...user }) => ({
      ...user,
      counts: {
        assignments: _count.assignments,
        notes: _count.notes,
        decks: _count.decks,
        sessions: _count.studySessions,
      },
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNext: query.page < totalPages,
      hasPrevious: query.page > 1,
    },
  };
}

export async function getUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      name: true,
      avatarUrl: true,
      bio: true,
      role: true,
      emailVerified: true,
      twoFactorEnabled: true,
      currentStreak: true,
      longestStreak: true,
      totalXp: true,
      createdAt: true,
      updatedAt: true,
      lastActiveDate: true,
      deletedAt: true,
      accounts: { select: { provider: true, createdAt: true } },
      sessions: {
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, userAgent: true, ipAddress: true, lastSeenAt: true },
        orderBy: { lastSeenAt: 'desc' },
        take: 10,
      },
      _count: {
        select: {
          assignments: true,
          notes: true,
          decks: true,
          studySessions: true,
          aiConversations: true,
          groupMemberships: true,
        },
      },
    },
  });

  if (!user) throw new NotFoundError('User');

  const { _count, ...rest } = user;
  return { ...rest, counts: _count };
}

/** Writes an attributable audit entry for a privileged action. */
async function recordAdminAction(
  actorId: string,
  action: string,
  entityId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await prisma.activityLog.create({
    data: {
      userId: actorId,
      action,
      entityType: 'User',
      entityId,
      metadata: (metadata as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
    },
  });
}

export async function changeRole(
  actorId: string,
  targetId: string,
  role: Role,
): Promise<void> {
  // An admin demoting themselves could leave the platform with no admin at
  // all, so self-demotion is refused outright.
  if (actorId === targetId) {
    throw new BadRequestError('You cannot change your own role');
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { role: true },
  });
  if (!target) throw new NotFoundError('User');

  if (target.role === Role.ADMIN && role !== Role.ADMIN) {
    const remainingAdmins = await prisma.user.count({
      where: { role: Role.ADMIN, deletedAt: null, id: { not: targetId } },
    });
    if (remainingAdmins === 0) {
      throw new BadRequestError('Cannot demote the last remaining administrator');
    }
  }

  await prisma.user.update({ where: { id: targetId }, data: { role } });
  await recordAdminAction(actorId, 'admin.user.role_changed', targetId, {
    from: target.role,
    to: role,
  });
}

/**
 * Suspends an account: marks it deleted and revokes every credential, so the
 * user is signed out everywhere immediately rather than at token expiry.
 */
export async function suspendUser(
  actorId: string,
  targetId: string,
  reason?: string,
): Promise<void> {
  if (actorId === targetId) throw new BadRequestError('You cannot suspend your own account');

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { role: true, deletedAt: true },
  });
  if (!target) throw new NotFoundError('User');
  if (target.deletedAt) throw new BadRequestError('That account is already suspended');
  if (target.role === Role.ADMIN) {
    throw new ForbiddenError('Demote this administrator before suspending the account');
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: targetId }, data: { deletedAt: new Date() } }),
    prisma.session.updateMany({
      where: { userId: targetId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: targetId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await recordAdminAction(actorId, 'admin.user.suspended', targetId, { reason: reason ?? null });
}

export async function reinstateUser(actorId: string, targetId: string): Promise<void> {
  const result = await prisma.user.updateMany({
    where: { id: targetId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
  if (result.count === 0) throw new NotFoundError('Suspended user');

  await recordAdminAction(actorId, 'admin.user.reinstated', targetId);
}

/** Signs a user out of every device without suspending the account. */
export async function revokeUserSessions(actorId: string, targetId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId: targetId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await prisma.refreshToken.updateMany({
    where: { userId: targetId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await recordAdminAction(actorId, 'admin.user.sessions_revoked', targetId, {
    count: result.count,
  });

  return result.count;
}

// --- Moderation -------------------------------------------------------------

export async function listRecentMessages(query: { limit: number; groupId?: string | undefined }) {
  return prisma.message.findMany({
    where: {
      deletedAt: null,
      ...(query.groupId ? { channel: { groupId: query.groupId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: query.limit,
    select: {
      id: true,
      content: true,
      createdAt: true,
      author: { select: { id: true, name: true, username: true, avatarUrl: true } },
      channel: {
        select: { id: true, name: true, group: { select: { id: true, name: true } } },
      },
    },
  });
}

/** Removes a message platform-wide, regardless of group membership. */
export async function moderateMessage(
  actorId: string,
  messageId: string,
  reason?: string,
): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, deletedAt: true },
  });
  if (!message || message.deletedAt) throw new NotFoundError('Message');

  await prisma.message.update({
    where: { id: messageId },
    data: { deletedAt: new Date(), content: '[removed by a moderator]' },
  });

  await prisma.activityLog.create({
    data: {
      userId: actorId,
      action: 'admin.message.removed',
      entityType: 'Message',
      entityId: messageId,
      metadata: { reason: reason ?? null },
    },
  });
}

export async function listGroups(query: { limit: number; search?: string | undefined }) {
  return prisma.studyGroup.findMany({
    where: query.search
      ? { name: { contains: query.search, mode: 'insensitive' } }
      : undefined,
    orderBy: { createdAt: 'desc' },
    take: query.limit,
    select: {
      id: true,
      name: true,
      slug: true,
      isPublic: true,
      createdAt: true,
      owner: { select: { id: true, name: true, username: true } },
      _count: { select: { members: true, channels: true } },
    },
  });
}

// --- Activity log -----------------------------------------------------------

export async function listActivityLogs(query: {
  page: number;
  limit: number;
  action?: string | undefined;
  userId?: string | undefined;
}) {
  const where: Prisma.ActivityLogWhereInput = {};
  if (query.action) where.action = { contains: query.action, mode: 'insensitive' };
  if (query.userId) where.userId = query.userId;

  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        ipAddress: true,
        createdAt: true,
        user: { select: { id: true, name: true, username: true } },
      },
    }),
    prisma.activityLog.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / query.limit));

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNext: query.page < totalPages,
      hasPrevious: query.page > 1,
    },
  };
}

// --- System health ----------------------------------------------------------

export interface SystemHealth {
  uptimeSeconds: number;
  nodeVersion: string;
  environment: string;
  memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
  database: { reachable: boolean; latencyMs: number | null };
  integrations: { gemini: boolean; cloudinary: boolean; redis: boolean; oauth: string[] };
}

export async function getSystemHealth(config: {
  gemini: boolean;
  cloudinary: boolean;
  redis: boolean;
  oauth: string[];
  environment: string;
}): Promise<SystemHealth> {
  const memory = process.memoryUsage();

  let reachable = false;
  let latencyMs: number | null = null;

  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    reachable = true;
    latencyMs = Date.now() - startedAt;
  } catch {
    // Reported rather than thrown — the health endpoint must still respond
    // when the database is down, that being the situation it exists for.
    reachable = false;
  }

  return {
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    environment: config.environment,
    memory: {
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
    },
    database: { reachable, latencyMs },
    integrations: {
      gemini: config.gemini,
      cloudinary: config.cloudinary,
      redis: config.redis,
      oauth: config.oauth,
    },
  };
}

export async function getUniversityOverview() {
  const [
    totalConnections,
    activeConnections,
    recentSyncs,
    failedSyncs,
  ] = await Promise.all([
    prisma.lmsConnection.count(),
    prisma.lmsConnection.count({ where: { status: 'CONNECTED' } }),
    prisma.syncLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        startedAt: true,
        endedAt: true,
        assignmentsCreated: true,
        gradesCreated: true,
        errors: true,
        connection: {
          select: {
            id: true,
            provider: true,
            user: { select: { id: true, name: true, username: true } },
          },
        },
      },
    }),
    prisma.syncLog.count({
      where: { status: 'FAILED', startedAt: { gte: new Date(Date.now() - 7 * 86400000) } },
    }),
  ]);

  return {
    totalConnections,
    activeConnections,
    recentSyncs,
    failedSyncs7d: failedSyncs,
  };
}

export const adminService = {
  getOverview,
  listUsers,
  getUser,
  changeRole,
  suspendUser,
  reinstateUser,
  revokeUserSessions,
  listRecentMessages,
  moderateMessage,
  listGroups,
  listActivityLogs,
  getSystemHealth,
  getUniversityOverview,
} as const;
