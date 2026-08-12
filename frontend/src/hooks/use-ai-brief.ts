'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

export interface DailyBrief {
  motivation: string;
  workload: string;
  outlook: string;
  priorities: { title: string; detail: string }[];
  suggestion: string;
  generatedAt: string;
}

export function useAiBrief() {
  return useQuery({
    queryKey: ['ai', 'brief'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<DailyBrief | null>>('/ai/brief');
      return data.data;
    },
    // The endpoint always returns immediately (fast path); when today's brief
    // is missing, the server kicks off regeneration in the background. Poll
    // every 15 s so the freshly-generated brief appears without a manual
    // refresh — Gemini typically finishes well within a minute.
    staleTime: 30 * 60_000,
    refetchInterval: (query) => {
      const brief = query.state.data as DailyBrief | null | undefined;
      if (!brief?.generatedAt) return 15_000;
      // If the brief we have is from today, we're done — stop polling.
      const generated = new Date(brief.generatedAt);
      const now = new Date();
      const sameDay =
        generated.getUTCFullYear() === now.getUTCFullYear() &&
        generated.getUTCMonth() === now.getUTCMonth() &&
        generated.getUTCDate() === now.getUTCDate();
      return sameDay ? false : 15_000;
    },
    refetchIntervalInBackground: false,
    retry: 1,
  });
}
