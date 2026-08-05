'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

export interface UpcomingExam {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  location: string | null;
  minutesToExam: number;
  subject: { id: string; name: string; color: string | null } | null;
}

export interface ExamWorkspaceData {
  upcoming: UpcomingExam[];
  past: UpcomingExam[];
  weakTopicsBySubject: {
    subjectId: string;
    subjectName: string;
    weakTopics: string[];
    masteryScore: number;
    confidenceScore: number;
  }[];
}

export function useExamWorkspace() {
  return useQuery({
    queryKey: ['exam-workspace'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<ExamWorkspaceData>>('/exam-workspace');
      return data.data;
    },
    staleTime: 60_000,
  });
}
