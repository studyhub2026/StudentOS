'use client';

import { motion } from 'framer-motion';
import {
  Award,
  Check,
  Coins,
  Crown,
  Flame,
  Medal,
  Target,
  Trophy,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGamification, useLeaderboard } from '@/hooks/use-gamification';
import { useAuthStore } from '@/stores/auth-store';

export default function AchievementsPage() {
  const { data: profile, isLoading } = useGamification();
  const { data: leaderboard } = useLeaderboard();
  const currentUser = useAuthStore((s) => s.user);

  if (isLoading || !profile) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-fg-muted">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          Loading achievements...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Achievements & Rewards</h1>
        <p className="text-fg-muted">Level up, complete missions, and climb the leaderboard.</p>
      </div>

      {/* Level & Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 text-fg-muted">
            <Crown className="h-4 w-4 text-warning" />
            <span className="text-sm">Level</span>
          </div>
          <p className="mt-2 text-3xl font-bold">{profile.xpProgress.level}</p>
          <div className="mt-2">
            <div className="h-2 overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand to-accent transition-all"
                style={{ width: `${profile.xpProgress.percent}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-fg-subtle">
              {profile.xpProgress.current}/{profile.xpProgress.needed} XP to level {profile.xpProgress.level + 1}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 text-fg-muted">
            <Zap className="h-4 w-4 text-teal" />
            <span className="text-sm">Total XP</span>
          </div>
          <p className="mt-2 text-3xl font-bold tabular-nums">{profile.totalXp.toLocaleString()}</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 text-fg-muted">
            <Coins className="h-4 w-4 text-warning" />
            <span className="text-sm">Coins</span>
          </div>
          <p className="mt-2 text-3xl font-bold tabular-nums">{profile.coins.toLocaleString()}</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 text-fg-muted">
            <Flame className="h-4 w-4 text-danger" />
            <span className="text-sm">Streak</span>
          </div>
          <p className="mt-2 text-3xl font-bold tabular-nums">{profile.currentStreak}d</p>
          <p className="mt-1 text-xs text-fg-subtle">Best: {profile.longestStreak}d</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Daily Missions */}
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <Target className="h-5 w-5 text-brand" />
            <h2 className="text-lg font-semibold">Daily Missions</h2>
          </div>
          <div className="space-y-3">
            {profile.missions.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'rounded-xl border p-3',
                  m.completed ? 'border-teal/30 bg-teal/8' : 'border-border',
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                      m.completed ? 'bg-teal/20 text-teal' : 'bg-surface-raised text-fg-muted',
                    )}
                  >
                    {m.completed ? <Check className="h-4 w-4" /> : <Target className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{m.title}</p>
                    <p className="text-xs text-fg-subtle">{m.description}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised">
                        <div
                          className="h-full rounded-full bg-brand transition-all"
                          style={{ width: `${Math.min(100, (m.progress / m.targetValue) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-fg-subtle">
                        {m.progress}/{m.targetValue}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs">
                    <span className="flex items-center gap-1 text-teal">
                      <Zap className="h-3 w-3" />
                      {m.xpReward}
                    </span>
                    <span className="flex items-center gap-1 text-warning">
                      <Coins className="h-3 w-3" />
                      {m.coinReward}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mb-2 mt-6 flex items-center gap-2">
            <Trophy className="h-5 w-5 text-warning" />
            <h2 className="text-lg font-semibold">Weekly Challenges</h2>
          </div>
          <div className="space-y-3">
            {profile.challenges.map((c) => (
              <div
                key={c.id}
                className={cn(
                  'rounded-xl border p-3',
                  c.completed ? 'border-warning/30 bg-warning/8' : 'border-border',
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                      c.completed ? 'bg-warning/20 text-warning' : 'bg-surface-raised text-fg-muted',
                    )}
                  >
                    {c.completed ? <Check className="h-4 w-4" /> : <Trophy className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{c.title}</p>
                    <p className="text-xs text-fg-subtle">{c.description}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised">
                        <div
                          className="h-full rounded-full bg-warning transition-all"
                          style={{ width: `${Math.min(100, (c.progress / c.targetValue) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-fg-subtle">
                        {c.progress}/{c.targetValue}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs">
                    <span className="flex items-center gap-1 text-teal">
                      <Zap className="h-3 w-3" />
                      {c.xpReward}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Leaderboard + Badges */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="mb-4 flex items-center gap-2">
              <Medal className="h-5 w-5 text-warning" />
              <h2 className="text-lg font-semibold">Leaderboard</h2>
            </div>
            <div className="space-y-1">
              {leaderboard?.map((entry, i) => (
                <div
                  key={entry.id}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-2 py-2',
                    entry.id === currentUser?.id && 'bg-brand/12',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold',
                      i === 0 && 'bg-warning/20 text-warning',
                      i === 1 && 'bg-fg-subtle/20 text-fg-muted',
                      i === 2 && 'bg-amber-700/20 text-amber-600',
                      i > 2 && 'bg-surface-raised text-fg-subtle',
                    )}
                  >
                    {i + 1}
                  </span>
                  {entry.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                  ) : (
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-brand to-accent text-xs font-semibold text-white">
                      {entry.name[0]?.toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.name}</p>
                    <p className="text-xs text-fg-subtle">Level {entry.level}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-teal">
                    {entry.totalXp.toLocaleString()} XP
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="mb-4 flex items-center gap-2">
              <Award className="h-5 w-5 text-brand" />
              <h2 className="text-lg font-semibold">Badges</h2>
            </div>
            {profile.achievements.length === 0 ? (
              <p className="py-6 text-center text-sm text-fg-subtle">
                No badges yet. Complete missions and challenges to earn them!
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {profile.achievements.map((a) => (
                  <motion.div
                    key={a.id}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-xl border p-3 text-center',
                      a.unlockedAt ? 'border-brand/30 bg-brand/8' : 'border-border opacity-50',
                    )}
                  >
                    <span className="text-2xl">{a.achievement.icon}</span>
                    <p className="text-[10px] font-medium leading-tight">{a.achievement.name}</p>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
