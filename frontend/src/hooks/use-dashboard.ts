'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import type {
  ApiEnvelope,
  CreateSubjectBody,
  DashboardOverview,
  Subject,
} from '@/types/api';

export function useDashboard(trendDays = 14) {
  return useQuery({
    queryKey: ['dashboard', 'overview', trendDays],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<DashboardOverview>>(
        '/dashboard/overview',
        { params: { trendDays } },
      );
      return data.data;
    },
    staleTime: 60_000,
    // The dashboard is a landing surface — refresh it when the tab regains
    // focus so stale figures aren't shown after a long absence.
    refetchOnWindowFocus: true,
  });
}

export function useSubjects(includeArchived = false) {
  return useQuery({
    queryKey: ['subjects', { includeArchived }],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<Subject[]>>('/subjects', {
        params: { includeArchived },
      });
      return data.data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useCreateSubject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreateSubjectBody) => {
      const { data } = await apiClient.post<ApiEnvelope<Subject>>('/subjects', body);
      return data.data;
    },
    onSuccess: (subject) => {
      void queryClient.invalidateQueries({ queryKey: ['subjects'] });
      toast.success(`"${subject.name}" added`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useDeleteSubject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/subjects/${id}`);
      return id;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['subjects'] });
      void queryClient.invalidateQueries({ queryKey: ['assignments'] });
      toast.success('Subject deleted');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}
