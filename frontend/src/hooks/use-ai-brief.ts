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
    // Generated once per day server-side; no need to refetch aggressively.
    staleTime: 30 * 60_000,
    retry: 1,
  });
}
