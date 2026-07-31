'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

export interface AiMemoryItem {
  id: string;
  key: string;
  value: string;
  category: string;
  updatedAt: string;
}

const memoryKey = ['ai', 'memory'] as const;

export function useAiMemory() {
  return useQuery({
    queryKey: memoryKey,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<AiMemoryItem[]>>('/ai/memory');
      return data.data;
    },
    staleTime: 60_000,
  });
}

export function useDeleteMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/ai/memory/${id}`);
      return id;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: memoryKey }),
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useClearMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.delete<ApiEnvelope<{ cleared: number }>>('/ai/memory');
      return data.data;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: memoryKey });
      toast.success(`Cleared ${result.cleared} ${result.cleared === 1 ? 'memory' : 'memories'}`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}
