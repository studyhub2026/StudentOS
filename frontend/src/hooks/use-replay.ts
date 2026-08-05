'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

export interface ReplayData {
  year: number;
  totals: {
    studyMinutes: number;
    focusMinutes: number;
    sessions: number;
    assignmentsCompleted: number;
    notesWritten: number;
    flashcardsReviewed: number;
    achievementsUnlocked: number;
    longestStreak: number;
  };
  topSubject: { name: string; color: string | null; minutes: number } | null;
  biggestDay: { date: string; minutes: number } | null;
  favouriteHour: number | null;
  achievements: { name: string; icon: string; tier: string; unlockedAt: string }[];
  monthlyMinutes: { month: number; minutes: number }[];
}

export function useReplay(year?: number) {
  return useQuery({
    queryKey: ['replay', year ?? 'current'],
    queryFn: async () => {
      const params = year ? `?year=${year}` : '';
      const { data } = await apiClient.get<ApiEnvelope<ReplayData>>(`/replay${params}`);
      return data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
