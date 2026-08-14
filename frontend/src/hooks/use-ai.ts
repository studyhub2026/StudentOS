'use client';

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import { postSse } from '@/lib/sse';
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

/** Creates an empty chat conversation and returns its id. */
export async function createChatConversation(): Promise<string> {
  const { data } = await apiClient.post<ApiEnvelope<ConversationDetail>>('/ai/conversations', {
    feature: 'CHAT',
  });
  return data.data.id;
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
      fileIds?: string[];
    }) => {
      const { data } = await apiClient.post<ApiEnvelope<ChatResult>>('/ai/chat', {
        feature: 'CHAT',
        content: input.content,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.tier ? { tier: input.tier } : {}),
        ...(input.fileIds && input.fileIds.length > 0 ? { fileIds: input.fileIds } : {}),
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

/**
 * Streaming chat hook. Same request payload as `useSendChat` — but the reply
 * arrives token-by-token via the SSE endpoint at `/ai/chat/stream`, so the
 * user sees the answer forming instead of waiting for the whole thing.
 *
 * Optimistic updates:
 *   - User's turn is appended to the React Query cache immediately.
 *   - A placeholder assistant turn (`__streaming: true`) is appended too and
 *     patched on every `delta` frame. The placeholder id is stable for the
 *     duration of the stream so React reconciles the same bubble.
 *   - The `done` frame invalidates the conversation list so the sidebar
 *     picks up the new/renamed thread.
 *
 * Aborting: `stop()` cancels the in-flight fetch; the server-side generator
 * observes `req.signal.aborted` and persists whatever accumulated so far.
 */
export type AiProviderChoice = 'gemini' | 'deepseek';

export interface StreamChatInput {
  conversationId?: string;
  content: string;
  tier?: AiTier;
  fileIds?: string[];
  /** Which provider to try first. Server falls back to Gemini on failure. */
  provider?: AiProviderChoice;
  /** Explicit academic context attached via the composer's context selector. */
  contextRefs?: { type: 'note' | 'subject' | 'document'; id: string }[];
}

export function useSendChatStream() {
  const queryClient = useQueryClient();
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const send = useCallback(
    async (input: StreamChatInput): Promise<{ conversationId: string } | null> => {
      // Cancel any prior in-flight turn before starting the next one.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      // Stable ids so React keys the same bubbles across delta patches.
      const userMessageId = `optimistic-user-${Date.now()}`;
      const assistantMessageId = `streaming-${Date.now()}`;
      const nowIso = new Date().toISOString();

      // The first meta frame carries the real conversationId (matters when we
      // started without one — server auto-creates it). Hold it in this scope.
      let conversationId = input.conversationId ?? null;

      // Append the optimistic user turn + empty assistant placeholder to the
      // conversation cache immediately, so the UI updates before the network.
      const seedConversation = (cid: string) => {
        queryClient.setQueryData<ConversationDetail>(
          aiKeys.conversation(cid),
          (current) => {
            const base: ConversationDetail = current ?? {
              id: cid,
              title: input.content.slice(0, 60),
              feature: 'CHAT',
              messages: [],
            };
            // Avoid double-appending if this render already ran.
            if (base.messages.some((m) => m.id === userMessageId)) return base;
            return {
              ...base,
              messages: [
                ...base.messages,
                { id: userMessageId, role: 'USER', content: input.content, createdAt: nowIso },
                { id: assistantMessageId, role: 'MODEL', content: '', createdAt: nowIso },
              ],
            };
          },
        );
      };

      if (conversationId) seedConversation(conversationId);

      // Patches only the assistant placeholder's content — cheap enough to run
      // on every delta because setQueryData structurally shares unchanged msgs.
      const patchAssistant = (nextContent: string) => {
        if (!conversationId) return;
        queryClient.setQueryData<ConversationDetail>(
          aiKeys.conversation(conversationId),
          (current) => {
            if (!current) return current;
            return {
              ...current,
              messages: current.messages.map((m) =>
                m.id === assistantMessageId ? { ...m, content: nextContent } : m,
              ),
            };
          },
        );
      };

      let accumulated = '';
      try {
        const generator = postSse(
          '/api/v1/ai/chat/stream',
          {
            feature: 'CHAT',
            content: input.content,
            ...(input.conversationId ? { conversationId: input.conversationId } : {}),
            ...(input.tier ? { tier: input.tier } : {}),
            ...(input.fileIds && input.fileIds.length > 0 ? { fileIds: input.fileIds } : {}),
            ...(input.provider ? { provider: input.provider } : {}),
            ...(input.contextRefs && input.contextRefs.length > 0 ? { contextRefs: input.contextRefs } : {}),
          },
          controller.signal,
        );

        for await (const frame of generator) {
          if (frame.event === 'meta') {
            const meta = JSON.parse(frame.data) as { conversationId: string };
            conversationId = meta.conversationId;
            seedConversation(conversationId);
          } else if (frame.event === 'delta') {
            const delta = JSON.parse(frame.data) as string;
            accumulated += delta;
            patchAssistant(accumulated);
          } else if (frame.event === 'error') {
            const err = JSON.parse(frame.data) as { message?: string };
            throw new Error(err.message ?? 'Streaming failed');
          }
        }

        // Once the stream closes we refresh the sidebar so a fresh conversation
        // shows up and its title/updated-at is authoritative.
        void queryClient.invalidateQueries({ queryKey: aiKeys.conversations() });
        return conversationId ? { conversationId } : null;
      } catch (error) {
        // Abort is a user action, not an error to toast.
        const wasAborted = controller.signal.aborted;
        if (!wasAborted) {
          const message = error instanceof Error ? error.message : apiErrorMessage(error);
          toast.error(message);
          // Roll back the empty assistant placeholder if we never got any
          // content, so the user isn't left staring at a blank bubble.
          if (!accumulated && conversationId) {
            queryClient.setQueryData<ConversationDetail>(
              aiKeys.conversation(conversationId),
              (current) =>
                current
                  ? {
                      ...current,
                      messages: current.messages.filter((m) => m.id !== assistantMessageId),
                    }
                  : current,
            );
          }
        }
        return null;
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [queryClient],
  );

  return { send, stop, isStreaming };
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

// --- Structured tools -------------------------------------------------------

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}
export interface QuizResult {
  questions: QuizQuestion[];
  model: string;
  totalTokens: number;
}
export interface SummaryResult {
  summary: string;
  keyPoints: string[];
  model: string;
  totalTokens: number;
}
export interface ExamQuestion {
  number: number;
  question: string;
  marks: number;
  markScheme: string;
  topic?: string;
}
export interface ExamResult {
  title: string;
  durationMinutes: number;
  totalMarks: number;
  questions: ExamQuestion[];
  model: string;
  totalTokens: number;
}
export interface ExplainResult {
  definition: string;
  explanation: string;
  example: string;
  commonMistake: string;
  relatedConcepts: string[];
  model: string;
  totalTokens: number;
}
export interface RevisionResult {
  topic: string;
  keyFacts: string[];
  definitions: { term: string; meaning: string }[];
  formulae: string[];
  examTips: string[];
  model: string;
  totalTokens: number;
}
export interface LearningStep {
  order: number;
  title: string;
  description: string;
  estimatedHours: number;
  masteryCheck: string;
}
export interface LearningPathResult {
  goal: string;
  totalHours: number;
  steps: LearningStep[];
  model: string;
  totalTokens: number;
}
export interface CoachResult {
  message: string;
  model: string;
  totalTokens: number;
}

function useAiTool<TInput, TResult>(path: string) {
  return useMutation({
    mutationFn: async (input: TInput) => {
      const { data } = await apiClient.post<ApiEnvelope<TResult>>(path, input);
      return data.data;
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export const useQuiz = () =>
  useAiTool<{ source: string; count: number }, QuizResult>('/ai/quiz');
export const useSummarise = () =>
  useAiTool<{ source: string }, SummaryResult>('/ai/summarise');
export const useExam = () =>
  useAiTool<
    { source: string; questionCount: number; durationMinutes: number; level: string; subject: string },
    ExamResult
  >('/ai/exam');
export const useExplain = () =>
  useAiTool<{ concept: string; level: string; context?: string }, ExplainResult>('/ai/explain');
export const useRevision = () =>
  useAiTool<{ source: string; topic: string }, RevisionResult>('/ai/revision');
export const useLearningPath = () =>
  useAiTool<
    { goal: string; currentLevel: string; hoursPerWeek: number },
    LearningPathResult
  >('/ai/learning-path');
export const useCoach = () =>
  useAiTool<{ situation: string; includeStats: boolean }, CoachResult>('/ai/coach');
