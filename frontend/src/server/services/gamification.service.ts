import 'server-only';
import { prisma } from '@/server/db';

const XP_PER_LEVEL = 500;

export function levelFromXp(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}

export function xpForLevel(level: number): number {
  return (level - 1) * XP_PER_LEVEL;
}

export function xpProgress(xp: number): { level: number; current: number; needed: number; percent: number } {
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const current = xp - base;
  return { level, current, needed: XP_PER_LEVEL, percent: Math.round((current / XP_PER_LEVEL) * 100) };
}

export async function awardXp(userId: string, amount: number): Promise<{ totalXp: number; level: number; coins: number }> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      totalXp: { increment: amount },
      coins: { increment: Math.floor(amount / 5) },
    },
    select: { totalXp: true, coins: true },
  });
  const level = levelFromXp(user.totalXp);
  await prisma.user.update({ where: { id: userId }, data: { level } });
  return { totalXp: user.totalXp, level, coins: user.coins };
}

interface MissionTemplate {
  key: string;
  title: string;
  description: string;
  icon: string;
  target: number;
  xp: number;
  coins: number;
}

const DAILY_MISSION_POOL: MissionTemplate[] = [
  { key: 'study_30m', title: 'Study for 30 minutes', description: 'Complete 30 minutes of study sessions', icon: 'timer', target: 30, xp: 30, coins: 15 },
  { key: 'review_10', title: 'Review 10 flashcards', description: 'Review at least 10 flashcards', icon: 'layers', target: 10, xp: 25, coins: 10 },
  { key: 'complete_1', title: 'Complete an assignment', description: 'Mark one assignment as completed', icon: 'check-square', target: 1, xp: 40, coins: 20 },
  { key: 'note_1', title: 'Write a note', description: 'Create or update a note', icon: 'book-open', target: 1, xp: 20, coins: 10 },
  { key: 'ai_chat_3', title: 'Ask AI 3 questions', description: 'Send 3 messages to AI chat or tutor', icon: 'bot', target: 3, xp: 20, coins: 10 },
  { key: 'focus_1', title: 'Complete a focus session', description: 'Finish one Pomodoro or deep work session', icon: 'zap', target: 1, xp: 35, coins: 15 },
  { key: 'streak_login', title: 'Keep your streak', description: 'Log in and study today', icon: 'flame', target: 1, xp: 15, coins: 5 },
  { key: 'quiz_1', title: 'Take a quiz', description: 'Complete at least one AI quiz', icon: 'file-text', target: 1, xp: 30, coins: 15 },
];

const WEEKLY_CHALLENGE_POOL: MissionTemplate[] = [
  { key: 'study_5h', title: 'Study 5 hours this week', description: 'Accumulate 5 hours of study time', icon: 'clock', target: 300, xp: 200, coins: 100 },
  { key: 'review_50', title: 'Review 50 flashcards', description: 'Review 50 flashcards over the week', icon: 'layers', target: 50, xp: 150, coins: 75 },
  { key: 'complete_5', title: 'Complete 5 assignments', description: 'Mark 5 assignments as completed', icon: 'check-square', target: 5, xp: 250, coins: 125 },
  { key: 'streak_7', title: '7-day streak', description: 'Maintain a 7-day study streak', icon: 'flame', target: 7, xp: 300, coins: 150 },
  { key: 'notes_3', title: 'Write 3 notes', description: 'Create at least 3 notes this week', icon: 'book-open', target: 3, xp: 150, coins: 75 },
];

const MONTHLY_CHALLENGE_POOL: MissionTemplate[] = [
  { key: 'study_25h', title: 'Study 25 hours this month', description: 'Long-haul goal — averages under an hour a day', icon: 'clock', target: 1500, xp: 600, coins: 300 },
  { key: 'complete_20', title: 'Complete 20 assignments', description: 'Sustained delivery all month', icon: 'check-square', target: 20, xp: 800, coins: 400 },
  { key: 'streak_20', title: '20-day study streak', description: 'Show up 20 days out of the month', icon: 'flame', target: 20, xp: 900, coins: 450 },
  { key: 'review_200', title: 'Review 200 flashcards', description: 'Long-term recall practice', icon: 'layers', target: 200, xp: 500, coins: 250 },
  { key: 'notes_10', title: 'Write 10 notes', description: 'Turn what you learn into notes you keep', icon: 'book-open', target: 10, xp: 500, coins: 250 },
];

function pickRandom<T>(pool: T[], count: number): T[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function todayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function weekStartUtc(): Date {
  const d = todayUtc();
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  return d;
}

function monthStartUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function getDailyMissions(userId: string) {
  const date = todayUtc();
  let missions = await prisma.dailyMission.findMany({
    where: { userId, date },
    orderBy: { createdAt: 'asc' },
  });

  if (missions.length === 0) {
    const templates = pickRandom(DAILY_MISSION_POOL, 3);
    await prisma.dailyMission.createMany({
      data: templates.map((t) => ({
        userId,
        date,
        missionKey: t.key,
        title: t.title,
        description: t.description,
        icon: t.icon,
        xpReward: t.xp,
        coinReward: t.coins,
        targetValue: t.target,
      })),
    });
    missions = await prisma.dailyMission.findMany({
      where: { userId, date },
      orderBy: { createdAt: 'asc' },
    });
  }

  return missions;
}

export async function getWeeklyChallenges(userId: string) {
  const weekStart = weekStartUtc();
  let challenges = await prisma.weeklyChallenge.findMany({
    where: { userId, weekStart },
    orderBy: { createdAt: 'asc' },
  });

  if (challenges.length === 0) {
    const templates = pickRandom(WEEKLY_CHALLENGE_POOL, 2);
    await prisma.weeklyChallenge.createMany({
      data: templates.map((t) => ({
        userId,
        weekStart,
        challengeKey: t.key,
        title: t.title,
        description: t.description,
        icon: t.icon,
        xpReward: t.xp,
        coinReward: t.coins,
        targetValue: t.target,
      })),
    });
    challenges = await prisma.weeklyChallenge.findMany({
      where: { userId, weekStart },
      orderBy: { createdAt: 'asc' },
    });
  }

  return challenges;
}

export async function getMonthlyChallenges(userId: string) {
  const monthStart = monthStartUtc();
  let challenges = await prisma.monthlyChallenge.findMany({
    where: { userId, monthStart },
    orderBy: { createdAt: 'asc' },
  });

  if (challenges.length === 0) {
    const templates = pickRandom(MONTHLY_CHALLENGE_POOL, 2);
    await prisma.monthlyChallenge.createMany({
      data: templates.map((t) => ({
        userId,
        monthStart,
        challengeKey: t.key,
        title: t.title,
        description: t.description,
        icon: t.icon,
        xpReward: t.xp,
        coinReward: t.coins,
        targetValue: t.target,
      })),
    });
    challenges = await prisma.monthlyChallenge.findMany({
      where: { userId, monthStart },
      orderBy: { createdAt: 'asc' },
    });
  }

  return challenges;
}

export async function updateMonthlyChallengeProgress(
  userId: string,
  challengeKey: string,
  increment: number,
): Promise<void> {
  const monthStart = monthStartUtc();
  const challenge = await prisma.monthlyChallenge.findUnique({
    where: { userId_monthStart_challengeKey: { userId, monthStart, challengeKey } },
  });
  if (!challenge || challenge.completed) return;

  const newProgress = Math.min(challenge.progress + increment, challenge.targetValue);
  const completed = newProgress >= challenge.targetValue;

  await prisma.monthlyChallenge.update({
    where: { id: challenge.id },
    data: {
      progress: newProgress,
      completed,
      ...(completed ? { completedAt: new Date() } : {}),
    },
  });

  if (completed) {
    await awardXp(userId, challenge.xpReward);
    await prisma.user.update({
      where: { id: userId },
      data: { coins: { increment: challenge.coinReward } },
    });
  }
}

export async function updateMissionProgress(
  userId: string,
  missionKey: string,
  increment: number,
): Promise<void> {
  const date = todayUtc();
  const mission = await prisma.dailyMission.findUnique({
    where: { userId_date_missionKey: { userId, date, missionKey } },
  });
  if (!mission || mission.completed) return;

  const newProgress = Math.min(mission.progress + increment, mission.targetValue);
  const completed = newProgress >= mission.targetValue;

  await prisma.dailyMission.update({
    where: { id: mission.id },
    data: {
      progress: newProgress,
      completed,
      ...(completed ? { completedAt: new Date() } : {}),
    },
  });

  if (completed) {
    await awardXp(userId, mission.xpReward);
    await prisma.user.update({
      where: { id: userId },
      data: { coins: { increment: mission.coinReward } },
    });
  }
}

export async function updateChallengeProgress(
  userId: string,
  challengeKey: string,
  increment: number,
): Promise<void> {
  const weekStart = weekStartUtc();
  const challenge = await prisma.weeklyChallenge.findUnique({
    where: { userId_weekStart_challengeKey: { userId, weekStart, challengeKey } },
  });
  if (!challenge || challenge.completed) return;

  const newProgress = Math.min(challenge.progress + increment, challenge.targetValue);
  const completed = newProgress >= challenge.targetValue;

  await prisma.weeklyChallenge.update({
    where: { id: challenge.id },
    data: {
      progress: newProgress,
      completed,
      ...(completed ? { completedAt: new Date() } : {}),
    },
  });

  if (completed) {
    await awardXp(userId, challenge.xpReward);
    await prisma.user.update({
      where: { id: userId },
      data: { coins: { increment: challenge.coinReward } },
    });
  }
}

export async function getLeaderboard(limit = 20) {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      username: true,
      avatarUrl: true,
      totalXp: true,
      currentStreak: true,
    },
    orderBy: { totalXp: 'desc' },
    take: limit,
  });
  // Derive level from XP so the board never shows a stale denormalised counter.
  return users.map((u) => ({ ...u, level: levelFromXp(u.totalXp) }));
}

export async function getGamificationProfile(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { totalXp: true, coins: true, level: true, currentStreak: true, longestStreak: true },
  });

  const progress = xpProgress(user.totalXp);

  // The stored level counter can drift behind XP (e.g. XP granted by legacy
  // flows). Treat the XP-derived level as authoritative and reconcile the
  // denormalised field so the sidebar and this page agree.
  if (user.level !== progress.level) {
    await prisma.user.update({ where: { id: userId }, data: { level: progress.level } });
    user.level = progress.level;
  }

  const [missions, challenges, monthlyChallenges, achievements] = await Promise.all([
    getDailyMissions(userId),
    getWeeklyChallenges(userId),
    getMonthlyChallenges(userId),
    prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: true },
      orderBy: { unlockedAt: 'desc' },
    }),
  ]);

  return {
    ...user,
    xpProgress: progress,
    missions,
    challenges,
    monthlyChallenges,
    achievements,
  };
}
