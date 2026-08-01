'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

interface KnowledgeCollection {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
  _count: { documents: number };
}

interface KnowledgeDocument {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageUrl: string;
  tags: string[];
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  collection: { id: string; name: string; color: string } | null;
}

interface SearchChunk {
  chunkId: string;
  documentId: string;
  filename: string;
  content: string;
  chunkIndex: number;
  pageNumber: number | null;
  heading: string | null;
}

interface AskResult {
  answer: string;
  sources: string[];
}

export function useKnowledgeCollections() {
  return useQuery({
    queryKey: ['knowledge-collections'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<KnowledgeCollection[]>>('/knowledge/collections');
      return data.data;
    },
  });
}

export function useKnowledgeDocuments(collectionId?: string) {
  return useQuery({
    queryKey: ['knowledge-documents', collectionId],
    queryFn: async () => {
      const params = collectionId ? `?collectionId=${collectionId}` : '';
      const { data } = await apiClient.get<ApiEnvelope<KnowledgeDocument[]>>(`/knowledge${params}`);
      return data.data;
    },
  });
}

export function useCreateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string; color?: string }) => {
      const { data } = await apiClient.post<ApiEnvelope<KnowledgeCollection>>('/knowledge/collections', input);
      return data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-collections'] }),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/knowledge/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-documents'] }),
  });
}

export function useSearchKnowledge(query: string) {
  return useQuery({
    queryKey: ['knowledge-search', query],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<SearchChunk[]>>(`/knowledge/search?q=${encodeURIComponent(query)}`);
      return data.data;
    },
    enabled: query.trim().length >= 2,
    staleTime: 30_000,
  });
}

export function useAskKnowledge() {
  return useMutation({
    mutationFn: async (input: { question: string; collectionId?: string; documentIds?: string[] }) => {
      const { data } = await apiClient.post<ApiEnvelope<AskResult>>('/knowledge/ask', input);
      return data.data;
    },
  });
}
