'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

export type TimelineEventKind =
  | 'assignment_created'
  | 'assignment_completed'
  | 'study_session'
  | 'focus_session'
  | 'schedule_block'
  | 'achievement'
  | 'note_created'
  | 'ai_conversation'
  | 'tutor_conversation';

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  at: string;
  title: string;
  subtitle: string | null;
  color: string | null;
  icon: string | null;
  url: string | null;
  minutes?: number;
}

export function useTimeline(days = 60) {
  return useQuery({
    queryKey: ['timeline', days],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<{ events: TimelineEvent[] }>>(
        `/timeline?days=${days}`,
      );
      return data.data.events;
    },
    staleTime: 60_000,
  });
}
