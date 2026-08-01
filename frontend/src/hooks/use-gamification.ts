'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

interface Mission {
  id: string;
  missionKey: string;
  title: string;
  description: string;
  icon: string;
  xpReward: number;
  coinReward: number;
  targetValue: number;
  progress: number;
  completed: boolean;
  completedAt: string | null;
}

interface Challenge {
  id: string;
  challengeKey: string;
  title: string;
  description: string;
  icon: string;
  xpReward: number;
  coinReward: number;
  targetValue: number;
  progress: number;
  completed: boolean;
  completedAt: string | null;
}

interface Achievement {
  id: string;
  progress: number;
  unlockedAt: string | null;
  achievement: {
    id: string;
    key: string;
    name: string;
    description: string;
    icon: string;
    xpReward: number;
    tier: string;
  };
}

interface XpProgress {
  level: number;
  current: number;
  needed: number;
  percent: number;
}

export interface GamificationProfile {
  totalXp: number;
  coins: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  xpProgress: XpProgress;
  missions: Mission[];
  challenges: Challenge[];
  achievements: Achievement[];
}

interface LeaderboardEntry {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  totalXp: number;
  level: number;
  currentStreak: number;
}

export function useGamification() {
  return useQuery({
    queryKey: ['gamification'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<GamificationProfile>>('/gamification');
      return data.data;
    },
    staleTime: 60_000,
  });
}

export function useLeaderboard() {
  return useQuery({
    queryKey: ['leaderboard'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<LeaderboardEntry[]>>('/gamification/leaderboard');
      return data.data;
    },
    staleTime: 120_000,
  });
}
