'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

export type Difficulty = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'ADAPTIVE';
export type AiTier = 'flash' | 'pro';

export interface TutorCard {
  id: string;
  subjectKey: string;
  subject: string;
  emoji: string;
  accent: string;
  difficulty: Difficulty;
  explanationStyle: string | null;
  goals: string | null;
  tagline: string;
  activated: boolean;
  masteryScore: number;
  confidenceScore: number;
  weakTopics: string[];
  quizzesTaken: number;
  conversationCount: number;
  lastConversation: { id: string; title: string; updatedAt: string } | null;
  lastActiveAt: string | null;
  /** 'subject' = academic tutor; 'role' = cross-subject sidekick (coach, planner, …). */
  kind: 'subject' | 'role';
}

export interface TutorMessage {
  id: string;
  role: 'USER' | 'MODEL' | 'SYSTEM';
  content: string;
  data?: TutorMessageData | null;
  pinned?: boolean;
  edited?: boolean;
  createdAt: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  topic?: string | null;
}
export interface QuizData {
  title: string;
  topic: string;
  questions: QuizQuestion[];
  messageId?: string | null;
}
export interface FlashcardData {
  topic: string;
  cards: { front: string; back: string; hint?: string | null }[];
  messageId?: string | null;
}
export type TutorMessageData =
  | { kind: 'quiz'; quiz: QuizData }
  | { kind: 'flashcards'; flashcards: FlashcardData };

export interface TutorConversationSummary {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: string;
  messageCount: number;
}
export interface TutorConversationDetail {
  id: string;
  title: string;
  pinned: boolean;
  messages: TutorMessage[];
}

export interface TutorProgress {
  weakTopics: string[];
  strongTopics: string[];
  masteryScore: number;
  confidenceScore: number;
  quizzesTaken: number;
  quizQuestions: number;
  quizCorrect: number;
  messagesCount: number;
}

export interface TutorInsightContent {
  todaysRecommendation: string;
  suggestedRevision?: string;
  weakTopics: string[];
  strongTopics?: string[];
  estimatedMastery: number;
  confidenceScore: number;
  summary: string;
}
export interface TutorRecommendation {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  done: boolean;
  createdAt: string;
}

export interface TutorDetail {
  tutor: Omit<TutorCard, 'tagline' | 'activated' | 'masteryScore' | 'confidenceScore' | 'weakTopics' | 'quizzesTaken' | 'conversationCount' | 'lastConversation'>;
  progress: TutorProgress;
  conversations: TutorConversationSummary[];
  insight: TutorInsightContent | null;
  insightGeneratedAt: string | null;
  recommendations: TutorRecommendation[];
}

export const tutorKeys = {
  all: ['tutors'] as const,
  list: () => [...tutorKeys.all, 'list'] as const,
  detail: (id: string) => [...tutorKeys.all, 'detail', id] as const,
  conversation: (tutorId: string, id: string) =>
    [...tutorKeys.all, 'conversation', tutorId, id] as const,
  insight: (tutorId: string) => [...tutorKeys.all, 'insight', tutorId] as const,
};

export function useTutors() {
  return useQuery({
    queryKey: tutorKeys.list(),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<TutorCard[]>>('/ai/tutors');
      return data.data;
    },
    staleTime: 30_000,
  });
}

export function useTutor(tutorId: string | null) {
  return useQuery({
    queryKey: tutorKeys.detail(tutorId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<TutorDetail>>(`/ai/tutors/${tutorId}`);
      return data.data;
    },
    enabled: Boolean(tutorId),
  });
}

/** Creates (or activates) a tutor for a subject and returns its id. */
export async function activateTutor(input: { subjectKey?: string; subject?: string }): Promise<string> {
  const { data } = await apiClient.post<ApiEnvelope<{ id: string }>>('/ai/tutors', input);
  return data.data.id;
}

export function useUpdateTutor(tutorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { difficulty?: Difficulty; explanationStyle?: string | null; goals?: string | null }) => {
      const { data } = await apiClient.patch<ApiEnvelope<unknown>>(`/ai/tutors/${tutorId}`, input);
      return data.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tutorKeys.detail(tutorId) });
      void qc.invalidateQueries({ queryKey: tutorKeys.list() });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useTutorConversation(tutorId: string, id: string | null) {
  return useQuery({
    queryKey: tutorKeys.conversation(tutorId, id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<TutorConversationDetail>>(
        `/ai/tutors/${tutorId}/conversations/${id}`,
      );
      return data.data;
    },
    enabled: Boolean(id),
  });
}

export async function createTutorConversation(tutorId: string): Promise<string> {
  const { data } = await apiClient.post<ApiEnvelope<{ id: string }>>(
    `/ai/tutors/${tutorId}/conversations`,
    {},
  );
  return data.data.id;
}

export function useDeleteTutorConversation(tutorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/ai/tutors/${tutorId}/conversations/${id}`);
      return id;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: tutorKeys.detail(tutorId) }),
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useUpdateTutorConversation(tutorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; title?: string; pinned?: boolean }) => {
      await apiClient.patch(`/ai/tutors/${tutorId}/conversations/${id}`, body);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: tutorKeys.detail(tutorId) }),
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useUpdateTutorMessage(tutorId: string, conversationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, ...body }: { messageId: string; pinned?: boolean; content?: string }) => {
      const { data } = await apiClient.patch<ApiEnvelope<TutorMessage>>(
        `/ai/tutors/${tutorId}/messages/${messageId}`,
        body,
      );
      return data.data;
    },
    onSuccess: () => {
      if (conversationId) {
        void qc.invalidateQueries({ queryKey: tutorKeys.conversation(tutorId, conversationId) });
      }
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useGenerateInsights(tutorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<ApiEnvelope<TutorInsightContent>>(
        `/ai/tutors/${tutorId}/insights`,
        {},
      );
      return data.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tutorKeys.detail(tutorId) });
      void qc.invalidateQueries({ queryKey: tutorKeys.list() });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useGenerateQuiz(tutorId: string) {
  return useMutation({
    mutationFn: async (input: { topic?: string; count?: number; conversationId?: string }) => {
      const { data } = await apiClient.post<ApiEnvelope<QuizData>>(`/ai/tutors/${tutorId}/quiz`, input);
      return data.data;
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useGenerateFlashcards(tutorId: string) {
  return useMutation({
    mutationFn: async (input: { topic?: string; count?: number; conversationId?: string }) => {
      const { data } = await apiClient.post<ApiEnvelope<FlashcardData>>(
        `/ai/tutors/${tutorId}/flashcards`,
        input,
      );
      return data.data;
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useSubmitQuiz(tutorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { total: number; correct: number; topic?: string; missedTopics?: string[] }) => {
      const { data } = await apiClient.post<ApiEnvelope<{ masteryScore: number }>>(
        `/ai/tutors/${tutorId}/quiz/submit`,
        input,
      );
      return data.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tutorKeys.detail(tutorId) });
      void qc.invalidateQueries({ queryKey: tutorKeys.list() });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useSetRecommendationDone(tutorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      await apiClient.patch(`/ai/tutors/${tutorId}/recommendations/${id}`, { done });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: tutorKeys.detail(tutorId) }),
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

