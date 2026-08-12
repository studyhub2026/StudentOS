'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

export interface MindMapSummary {
  id: string;
  title: string;
  description: string | null;
  favorite: boolean;
  aiGenerated: boolean;
  subjectId: string | null;
  subject: { id: string; name: string; color: string } | null;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MindMapNodeDto {
  id: string;
  parentId: string | null;
  type: string;
  title: string;
  content: string | null;
  x: number;
  y: number;
  color: string | null;
  icon: string | null;
  tags: string[];
  refType: string | null;
  refId: string | null;
  style: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface MindMapEdgeDto {
  id: string;
  sourceId: string;
  targetId: string;
  label: string | null;
  type: string;
  style: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface MindMapFull {
  id: string;
  title: string;
  description: string | null;
  favorite: boolean;
  aiGenerated: boolean;
  subjectId: string | null;
  subject: { id: string; name: string; color: string } | null;
  settings: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  nodes: MindMapNodeDto[];
  edges: MindMapEdgeDto[];
}

export interface BulkSavePayload {
  meta?: {
    title?: string;
    description?: string | null;
    favorite?: boolean;
    subjectId?: string | null;
    settings?: unknown;
  };
  nodes?: Partial<MindMapNodeDto> & { id: string }[];
  edges?: Partial<MindMapEdgeDto> & { id: string; sourceId: string; targetId: string }[];
  deletedNodeIds?: string[];
  deletedEdgeIds?: string[];
}

export function useMindMaps(opts: { favorite?: boolean; search?: string } = {}) {
  const params = new URLSearchParams();
  if (opts.favorite) params.set('favorite', 'true');
  if (opts.search) params.set('search', opts.search);
  const q = params.toString();
  return useQuery<MindMapSummary[]>({
    queryKey: ['mind-maps', opts.favorite ?? false, opts.search ?? ''],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<MindMapSummary[]>>(
        `/mind-maps${q ? `?${q}` : ''}`,
      );
      return data.data;
    },
    staleTime: 30_000,
  });
}

export function useMindMap(id: string | null) {
  return useQuery<MindMapFull>({
    queryKey: ['mind-map', id],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<MindMapFull>>(`/mind-maps/${id}`);
      return data.data;
    },
    enabled: !!id,
    // Loaded once at editor open; subsequent updates go through mutation
    // + optimistic local state.
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
}

export function useCreateMindMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title: string; description?: string; subjectId?: string; settings?: unknown }) => {
      const { data } = await apiClient.post<ApiEnvelope<{ id: string; title: string }>>('/mind-maps', input);
      return data.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mind-maps'] }),
  });
}

export function useDuplicateMindMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<ApiEnvelope<{ id: string }>>(`/mind-maps/${id}/duplicate`);
      return data.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mind-maps'] }),
  });
}

export function useDeleteMindMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/mind-maps/${id}`);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mind-maps'] }),
  });
}

export function useRenameMindMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title, favorite }: { id: string; title?: string; favorite?: boolean }) => {
      const { data } = await apiClient.patch<ApiEnvelope<{ updatedAt: string }>>(`/mind-maps/${id}`, {
        meta: { ...(title !== undefined ? { title } : {}), ...(favorite !== undefined ? { favorite } : {}) },
      });
      return data.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mind-maps'] }),
  });
}
