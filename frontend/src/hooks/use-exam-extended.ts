'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

export interface ExamAttemptSummary {
  id: string;
  title: string;
  subjectId: string | null;
  score: number | null;
  totalMarks: number;
  duration: number;
  startedAt: string;
  completedAt: string | null;
  subject: { name: string; color: string | null } | null;
}

export interface ExamAttemptFull extends ExamAttemptSummary {
  questions: { number: number; question: string; marks: number; markScheme: string; topic?: string }[];
  answers: Record<number, string> | null;
  analysis: {
    score: number;
    perQuestion: { number: number; marksAwarded: number; feedback: string }[];
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
  } | null;
}

export interface QuestionBankSummary {
  id: string;
  title: string;
  subjectId: string | null;
  createdAt: string;
  updatedAt: string;
  subject: { name: string; color: string | null } | null;
}

export function useExamHistory(subjectId?: string) {
  return useQuery<ExamAttemptSummary[]>({
    queryKey: ['exam-attempts', subjectId ?? 'all'],
    queryFn: async () => {
      const params = subjectId ? `?subjectId=${subjectId}` : '';
      const { data } = await apiClient.get<ApiEnvelope<ExamAttemptSummary[]>>(`/exam/attempts${params}`);
      return data.data;
    },
    staleTime: 30_000,
  });
}

export function useExamAttempt(attemptId: string | null) {
  return useQuery<ExamAttemptFull>({
    queryKey: ['exam-attempt', attemptId],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<ExamAttemptFull>>(`/exam/attempts/${attemptId}`);
      return data.data;
    },
    enabled: !!attemptId,
    staleTime: 60_000,
  });
}

export function useStartExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      title: string;
      subjectId?: string;
      questions: unknown[];
      totalMarks: number;
      duration: number;
    }) => {
      const { data } = await apiClient.post<ApiEnvelope<ExamAttemptFull>>('/exam/attempts', input);
      return data.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['exam-attempts'] });
    },
  });
}

export function useSubmitExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ attemptId, answers }: { attemptId: string; answers: Record<number, string> }) => {
      const { data } = await apiClient.patch<ApiEnvelope<ExamAttemptFull>>(`/exam/attempts/${attemptId}`, { answers });
      return data.data;
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['exam-attempts'] });
      void qc.invalidateQueries({ queryKey: ['exam-attempt', vars.attemptId] });
    },
  });
}

export function useQuestionBanks(subjectId?: string) {
  return useQuery<QuestionBankSummary[]>({
    queryKey: ['question-banks', subjectId ?? 'all'],
    queryFn: async () => {
      const params = subjectId ? `?subjectId=${subjectId}` : '';
      const { data } = await apiClient.get<ApiEnvelope<QuestionBankSummary[]>>(`/exam/question-banks${params}`);
      return data.data;
    },
    staleTime: 60_000,
  });
}

export function useSaveQuestionBank() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title: string; subjectId?: string; questions: unknown[] }) => {
      const { data } = await apiClient.post<ApiEnvelope<{ id: string }>>('/exam/question-banks', input);
      return data.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['question-banks'] });
    },
  });
}

export function useDeleteQuestionBank() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bankId: string) => {
      await apiClient.delete(`/exam/question-banks/${bankId}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['question-banks'] });
    },
  });
}
