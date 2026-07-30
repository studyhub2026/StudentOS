'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

export type AiFeature =
  | 'CHAT'
  | 'HOMEWORK_HELPER'
  | 'STUDY_PLANNER'
  | 'EXAM_SIMULATOR'
  | 'QUIZ_GENERATOR'
  | 'FLASHCARD_GENERATOR'
  | 'SUMMARIZER'
  | 'CONCEPT_EXPLAINER'
  | 'MOTIVATION_COACH'
  | 'REVISION_GENERATOR'
  | 'LEARNING_PATH';

export type AiTier = 'flash' | 'pro';

export interface AiMessage {
  id: string;
  role: 'USER' | 'MODEL';
  content: string;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  feature: AiFeature;
  pinned: boolean;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationDetail {
  id: string;
  title: string;
  feature: AiFeature;
  messages: AiMessage[];
}

interface ChatResult {
  conversationId: string;
  message: AiMessage;
  model: string;
  totalTokens: number;
  latencyMs: number;
}

export const aiKeys = {
  all: ['ai'] as const,
  status: () => [...aiKeys.all, 'status'] as const,
  conversations: () => [...aiKeys.all, 'conversations'] as const,
  conversation: (id: string) => [...aiKeys.all, 'conversation', id] as const,
};

export function useAiStatus() {
  return useQuery({
    queryKey: aiKeys.status(),
    queryFn: async () => {
      const { data } = await apiClient.get<
        ApiEnvelope<{ configured: boolean; provider: string; features: AiFeature[] }>
      >('/ai/status');
      return data.data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useConversations() {
  return useQuery({
    queryKey: aiKeys.conversations(),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<ConversationSummary[]>>('/ai/conversations');
      return data.data;
    },
    staleTime: 30_000,
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: aiKeys.conversation(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<ConversationDetail>>(
        `/ai/conversations/${id}`,
      );
      return data.data;
    },
    enabled: Boolean(id),
  });
}

/**
 * Sends a chat turn. The user message is appended optimistically so the thread
 * updates the instant the request leaves; the model's reply and the real
 * conversation id land when the response returns.
 */
export function useSendChat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      conversationId?: string;
      content: string;
      tier?: AiTier;
    }) => {
      const { data } = await apiClient.post<ApiEnvelope<ChatResult>>('/ai/chat', {
        feature: 'CHAT',
        content: input.content,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.tier ? { tier: input.tier } : {}),
      });
      return data.data;
    },
    onSuccess: (result) => {
      queryClient.setQueryData<ConversationDetail>(
        aiKeys.conversation(result.conversationId),
        (current) =>
          current
            ? { ...current, messages: [...current.messages, result.message] }
            : current,
      );
      void queryClient.invalidateQueries({ queryKey: aiKeys.conversations() });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/ai/conversations/${id}`);
      return id;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiKeys.conversations() });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}
