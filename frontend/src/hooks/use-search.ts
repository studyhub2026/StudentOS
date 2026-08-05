'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';
import { useDebouncedValue } from './use-debounced-value';

export type SearchCategory =
  | 'assignment'
  | 'note'
  | 'subject'
  | 'flashcard_deck'
  | 'flashcard'
  | 'schedule'
  | 'ai_conversation'
  | 'tutor_conversation'
  | 'group'
  | 'group_message'
  | 'uploaded_file'
  | 'goal'
  | 'notification';

export type HighlightRange = [number, number];

export interface SearchResult {
  id: string;
  category: SearchCategory;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  url: string;
  icon: string | null;
  color: string | null;
  updatedAt: string;
  titleHighlights?: HighlightRange[];
  excerptHighlights?: HighlightRange[];
  score?: number;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
}

export function useSearch(query: string, categories?: SearchCategory[]) {
  const debouncedQuery = useDebouncedValue(query, 200);

  return useQuery({
    queryKey: ['search', debouncedQuery, categories],
    queryFn: async () => {
      const params = new URLSearchParams({ q: debouncedQuery });
      if (categories?.length) params.set('categories', categories.join(','));
      const { data } = await apiClient.get<ApiEnvelope<SearchResponse>>(
        `/search?${params}`,
      );
      return data.data;
    },
    enabled: debouncedQuery.trim().length >= 1,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
