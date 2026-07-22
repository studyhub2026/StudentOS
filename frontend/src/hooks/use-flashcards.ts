'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import type {
  ApiEnvelope,
  ApiPaginatedEnvelope,
  CardDifficulty,
  CardFilters,
  CreateCardBody,
  CreateDeckBody,
  Deck,
  Flashcard,
  FlashcardStats,
  GenerateCardsResult,
  Pagination,
  ReviewCard,
  ReviewOutcome,
  ReviewRating,
} from '@/types/api';

export const deckKeys = {
  all: ['decks'] as const,
  lists: () => [...deckKeys.all, 'list'] as const,
  detail: (id: string) => [...deckKeys.all, 'detail', id] as const,
  cards: (id: string, filters: CardFilters) =>
    [...deckKeys.all, 'cards', id, filters] as const,
  queue: (deckId: string | undefined) => [...deckKeys.all, 'queue', deckId ?? 'all'] as const,
  stats: (deckId: string | undefined) => [...deckKeys.all, 'stats', deckId ?? 'all'] as const,
};

// Accepts any filter object; interfaces lack an index signature, so the
// parameter is constrained structurally rather than to Record<string, unknown>.
function toParams<T extends object>(filters: T): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params[key] = value.join(',');
    } else {
      params[key] = value as string | number | boolean;
    }
  }
  return params;
}

export function useDecks() {
  return useQuery({
    queryKey: deckKeys.lists(),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<Deck[]>>('/decks');
      return data.data;
    },
    staleTime: 30_000,
  });
}

export function useDeck(id: string | null) {
  return useQuery({
    queryKey: deckKeys.detail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<Deck>>(`/decks/${id}`);
      return data.data;
    },
    enabled: Boolean(id),
  });
}

export interface CardListResult {
  items: Flashcard[];
  pagination: Pagination;
}

export function useCards(deckId: string | null, filters: CardFilters) {
  return useQuery({
    queryKey: deckKeys.cards(deckId ?? '', filters),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiPaginatedEnvelope<Flashcard>>(
        `/decks/${deckId}/cards`,
        { params: toParams(filters) },
      );
      return { items: data.data, pagination: data.pagination } satisfies CardListResult;
    },
    enabled: Boolean(deckId),
    placeholderData: (previous) => previous,
  });
}

export function useFlashcardStats(deckId?: string) {
  return useQuery({
    queryKey: deckKeys.stats(deckId),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<FlashcardStats>>('/decks/stats', {
        params: deckId ? { deckId } : {},
      });
      return data.data;
    },
    staleTime: 60_000,
  });
}

/**
 * The review queue is fetched once per session and then held in the review
 * store. `staleTime: Infinity` prevents a refetch from reshuffling cards
 * mid-session.
 */
export function useReviewQueue(deckId?: string, enabled = true) {
  return useQuery({
    queryKey: deckKeys.queue(deckId),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<ReviewCard[]>>('/decks/queue', {
        params: deckId ? { deckId } : {},
      });
      return data.data;
    },
    enabled,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

function useInvalidateDecks() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: deckKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useCreateDeck() {
  const invalidate = useInvalidateDecks();

  return useMutation({
    mutationFn: async (body: CreateDeckBody) => {
      const { data } = await apiClient.post<ApiEnvelope<Deck>>('/decks', body);
      return data.data;
    },
    onSuccess: (deck) => {
      invalidate();
      toast.success(`"${deck.name}" created`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useUpdateDeck() {
  const invalidate = useInvalidateDecks();

  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Partial<CreateDeckBody> }) => {
      const { data } = await apiClient.patch<ApiEnvelope<Deck>>(`/decks/${id}`, body);
      return data.data;
    },
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useDeleteDeck() {
  const invalidate = useInvalidateDecks();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/decks/${id}`);
      return id;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Deck deleted');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useCreateCard() {
  const invalidate = useInvalidateDecks();

  return useMutation({
    mutationFn: async ({ deckId, body }: { deckId: string; body: CreateCardBody }) => {
      const { data } = await apiClient.post<ApiEnvelope<Flashcard>>(
        `/decks/${deckId}/cards`,
        body,
      );
      return data.data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Card added');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useBulkCreateCards() {
  const invalidate = useInvalidateDecks();

  return useMutation({
    mutationFn: async ({ deckId, cards }: { deckId: string; cards: CreateCardBody[] }) => {
      const { data } = await apiClient.post<ApiEnvelope<{ created: number }>>(
        `/decks/${deckId}/cards/bulk`,
        { cards },
      );
      return data.data;
    },
    onSuccess: (result) => {
      invalidate();
      toast.success(`${result.created} card${result.created === 1 ? '' : 's'} added`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useUpdateCard() {
  const invalidate = useInvalidateDecks();

  return useMutation({
    mutationFn: async ({
      cardId,
      body,
    }: {
      cardId: string;
      body: Partial<CreateCardBody> & { suspended?: boolean };
    }) => {
      const { data } = await apiClient.patch<ApiEnvelope<Flashcard>>(
        `/decks/cards/${cardId}`,
        body,
      );
      return data.data;
    },
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useDeleteCard() {
  const invalidate = useInvalidateDecks();

  return useMutation({
    mutationFn: async (cardId: string) => {
      await apiClient.delete(`/decks/cards/${cardId}`);
      return cardId;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Card deleted');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

/**
 * Submits a review. Cache invalidation is deferred to the end of the session
 * (see the review store) so grading a card does not refetch the queue and
 * disrupt the run.
 */
export function useReviewCard() {
  return useMutation({
    mutationFn: async ({
      cardId,
      rating,
      responseMs,
    }: {
      cardId: string;
      rating: ReviewRating;
      responseMs?: number;
    }) => {
      const { data } = await apiClient.post<ApiEnvelope<ReviewOutcome>>(
        `/decks/cards/${cardId}/review`,
        { rating, ...(responseMs === undefined ? {} : { responseMs }) },
      );
      return data.data;
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useGenerateCards() {
  const invalidate = useInvalidateDecks();

  return useMutation({
    mutationFn: async ({
      deckId,
      source,
      count,
      difficulty,
      save,
    }: {
      deckId: string;
      source: string;
      count: number;
      difficulty: CardDifficulty;
      save: boolean;
    }) => {
      const { data } = await apiClient.post<ApiEnvelope<GenerateCardsResult>>(
        `/decks/${deckId}/generate`,
        { source, count, difficulty, save },
      );
      return data.data;
    },
    onSuccess: (result) => {
      if (result.saved > 0) {
        invalidate();
        toast.success(`${result.saved} cards generated and saved`);
      }
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useImportDeck() {
  const invalidate = useInvalidateDecks();

  return useMutation({
    mutationFn: async (body: { format: 'json' | 'csv'; data: string; deckName?: string }) => {
      const { data } = await apiClient.post<ApiEnvelope<{ deck: Deck; imported: number }>>(
        '/decks/import',
        body,
      );
      return data.data;
    },
    onSuccess: (result) => {
      invalidate();
      toast.success(`Imported ${result.imported} cards into "${result.deck.name}"`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useResetDeck() {
  const invalidate = useInvalidateDecks();

  return useMutation({
    mutationFn: async (deckId: string) => {
      const { data } = await apiClient.post<ApiEnvelope<{ reset: number }>>(
        `/decks/${deckId}/reset`,
      );
      return data.data;
    },
    onSuccess: (result) => {
      invalidate();
      toast.success(`${result.reset} cards reset to new`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}
