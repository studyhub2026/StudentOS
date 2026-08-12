import 'server-only';
import { prisma } from '@/server/db';

type NotificationPrefs = Record<string, boolean>;

function isTypeEnabled(prefs: NotificationPrefs | null, type: string): boolean {
  if (!prefs) return true;
  return prefs[type] !== false;
}

export async function generateSmartNotifications(userId: string) {
  const [assignments, studySessions, user, settings] = await Promise.all([
    prisma.assignment.findMany({
      where: { userId, deletedAt: null, status: { notIn: ['COMPLETED', 'ARCHIVED'] } },
      select: { id: true, title: true, dueAt: true, status: true, priority: true, estimatedMinutes: true },
      orderBy: { dueAt: 'asc' },
      take: 20,
    }),
    prisma.studySession.findMany({
      where: { userId, startedAt: { gte: new Date(Date.now() - 7 * 86400000) } },
      select: { durationSeconds: true, type: true, startedAt: true },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, currentStreak: true, totalXp: true },
    }),
    prisma.userSettings.findUnique({
      where: { userId },
      select: { notificationPrefs: true },
    }),
  ]);

  const prefs = (settings?.notificationPrefs as NotificationPrefs | null) ?? null;

  const now = new Date();
  const notifications: { type: string; title: string; body: string; link: string; priority: string }[] = [];

  for (const a of assignments) {
    if (!a.dueAt) continue;
    const hoursLeft = (a.dueAt.getTime() - now.getTime()) / 3600000;
    if (hoursLeft < 0 && hoursLeft > -48) {
      notifications.push({
        type: 'ASSIGNMENT_OVERDUE',
        title: `Overdue: ${a.title}`,
        body: `This assignment is overdue by ${Math.abs(Math.round(hoursLeft))} hours.`,
        link: '/assignments',
        priority: 'HIGH',
      });
    } else if (hoursLeft > 0 && hoursLeft < 24) {
      notifications.push({
        type: 'ASSIGNMENT_DUE',
        title: `Due soon: ${a.title}`,
        body: `Due in ${Math.round(hoursLeft)} hours. ${a.estimatedMinutes ? `Estimated ${a.estimatedMinutes}min.` : ''}`,
        link: '/assignments',
        priority: 'HIGH',
      });
    } else if (hoursLeft > 24 && hoursLeft < 72) {
      notifications.push({
        type: 'ASSIGNMENT_DUE',
        title: `Upcoming: ${a.title}`,
        body: `Due in ${Math.round(hoursLeft / 24)} days.`,
        link: '/assignments',
        priority: 'MEDIUM',
      });
    }
  }

  const totalStudyMinutes = studySessions.reduce((sum, s) => sum + s.durationSeconds / 60, 0);
  const avgDailyMinutes = totalStudyMinutes / 7;

  if (avgDailyMinutes > 300) {
    notifications.push({
      type: 'SYSTEM',
      title: 'Burnout Warning',
      body: `You're averaging ${Math.round(avgDailyMinutes)} minutes/day. Consider taking a break to recharge.`,
      link: '/analytics',
      priority: 'MEDIUM',
    });
  }

  if (avgDailyMinutes < 15 && user.currentStreak > 0) {
    notifications.push({
      type: 'SYSTEM',
      title: 'Keep your streak!',
      body: `You have a ${user.currentStreak}-day streak. Study today to keep it going!`,
      link: '/focus',
      priority: 'MEDIUM',
    });
  }

  const cardssDue = await prisma.flashcard.count({
    where: { deck: { userId }, dueAt: { lte: now }, suspended: false },
  });
  if (cardssDue > 0) {
    notifications.push({
      type: 'FLASHCARD_REVIEW',
      title: `${cardssDue} cards due for review`,
      body: 'Keep your memory strong by reviewing your flashcards.',
      link: '/flashcards/review',
      priority: 'LOW',
    });
  }

  const filtered = notifications.filter((n) => isTypeEnabled(prefs, n.type));

  if (filtered.length === 0) return [];

  const existing = await prisma.notification.findMany({
    where: { userId, title: { in: filtered.map((n) => n.title) } },
    select: { id: true, title: true },
  });
  const existingByTitle = new Map(existing.map((e) => [e.title, e.id]));

  await prisma.$transaction(
    filtered.map((n) => {
      const id = existingByTitle.get(n.title);
      return id
        ? prisma.notification.update({ where: { id }, data: { body: n.body, link: n.link } })
        : prisma.notification.create({
            data: {
              userId,
              type: n.type as never,
              title: n.title,
              body: n.body,
              link: n.link,
            },
          });
    }),
  );

  return filtered;
}

export async function getNotifications(userId: string, unreadOnly = false) {
  return prisma.notification.findMany({
    where: {
      userId,
      ...(unreadOnly ? { readAt: null } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export async function markNotificationRead(userId: string, notificationId: string) {
  return prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
