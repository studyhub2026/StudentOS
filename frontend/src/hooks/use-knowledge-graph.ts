'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

export type GraphNodeKind =
  | 'subject'
  | 'note'
  | 'assignment'
  | 'deck'
  | 'document'
  | 'goal';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  color: string | null;
  url: string | null;
  subjectId?: string | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: 'contains' | 'related';
}

export function useKnowledgeGraph() {
  return useQuery({
    queryKey: ['knowledge-graph'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<{ nodes: GraphNode[]; edges: GraphEdge[] }>>(
        '/knowledge-graph',
      );
      return data.data;
    },
    staleTime: 60_000,
  });
}
