import 'server-only';
import { prisma } from '@/server/db';

/**
 * Public, aggregate view of a student. Only high-level counters and
 * self-published fields (username, name, avatar, bio) are ever exposed —
 * no assignments, notes, files or messages leak here.
 *
 * Returns null when the username doesn't exist or the user hasn't opted
 * their profile in — the caller then renders a 404.
 */
export async function getPublicProfile(username: string): Promise<PublicProfile | null> {
  const cleaned = username.trim().toLowerCase();
  if (!cleaned) return null;

  const user = await prisma.user.findFirst({
    where: {
      username: { equals: cleaned, mode: 'insensitive' },
      deletedAt: null,
      settings: { profilePublic: true },
    },
    select: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
      bio: true,
      currentStreak: true,
      longestStreak: true,
      totalXp: true,
      level: true,
      createdAt: true,
      _count: {
        select: {
          userAchievements: true,
          subjects: { where: { archived: false } },
          notes: { where: { deletedAt: null } },
        },
      },
    },
  });
  if (!user) return null;

  const [studyMinutes, recentAchievements] = await Promise.all([
    prisma.dailyStat.aggregate({
      where: { userId: user.id },
      _sum: { studySeconds: true },
    }),
    prisma.userAchievement.findMany({
      where: { userId: user.id, unlockedAt: { not: null } },
      orderBy: { unlockedAt: 'desc' },
      take: 6,
      select: {
        unlockedAt: true,
        achievement: {
          select: { key: true, name: true, description: true, icon: true, tier: true },
        },
      },
    }),
  ]);

  return {
    username: user.username,
    name: user.name,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    joinedAt: user.createdAt.toISOString(),
    stats: {
      totalXp: user.totalXp,
      level: user.level,
      currentStreak: user.currentStreak,
      longestStreak: user.longestStreak,
      totalStudyMinutes: Math.round((studyMinutes._sum.studySeconds ?? 0) / 60),
      subjectsCount: user._count.subjects,
      notesCount: user._count.notes,
      achievementsUnlocked: user._count.userAchievements,
    },
    achievements: recentAchievements.map((ua) => ({
      key: ua.achievement.key,
      name: ua.achievement.name,
      description: ua.achievement.description,
      icon: ua.achievement.icon,
      tier: ua.achievement.tier,
      unlockedAt: (ua.unlockedAt as Date).toISOString(),
    })),
  };
}

export interface PublicProfile {
  username: string;
  name: string;
  avatarUrl: string | null;
  bio: string | null;
  joinedAt: string;
  stats: {
    totalXp: number;
    level: number;
    currentStreak: number;
    longestStreak: number;
    totalStudyMinutes: number;
    subjectsCount: number;
    notesCount: number;
    achievementsUnlocked: number;
  };
  achievements: {
    key: string;
    name: string;
    description: string;
    icon: string;
    tier: string;
    unlockedAt: string;
  }[];
}
