'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import type {
  ApiEnvelope,
  ApiPaginatedEnvelope,
  Assignment,
  AssignmentFilters,
  AssignmentStats,
  CreateAssignmentBody,
  Pagination,
  UpdateAssignmentBody,
} from '@/types/api';

export const assignmentKeys = {
  all: ['assignments'] as const,
  lists: () => [...assignmentKeys.all, 'list'] as const,
  list: (filters: AssignmentFilters) => [...assignmentKeys.lists(), filters] as const,
  detail: (id: string) => [...assignmentKeys.all, 'detail', id] as const,
  stats: () => [...assignmentKeys.all, 'stats'] as const,
  labels: () => [...assignmentKeys.all, 'labels'] as const,
};

/** Arrays are sent comma-separated, matching the backend's csv parser. */
function toParams(filters: AssignmentFilters): Record<string, string | number | boolean> {
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

export interface AssignmentListResult {
  items: Assignment[];
  pagination: Pagination;
}

export function useAssignments(
  filters: AssignmentFilters,
): UseQueryResult<AssignmentListResult> {
  return useQuery({
    queryKey: assignmentKeys.list(filters),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiPaginatedEnvelope<Assignment>>('/assignments', {
        params: toParams(filters),
      });
      return { items: data.data, pagination: data.pagination };
    },
    // Keeps the previous page visible while the next one loads, avoiding a
    // full-list spinner on every pagination click.
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useAssignment(id: string | null) {
  return useQuery({
    queryKey: assignmentKeys.detail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<Assignment>>(`/assignments/${id}`);
      return data.data;
    },
    enabled: Boolean(id),
  });
}

export function useAssignmentStats() {
  return useQuery({
    queryKey: assignmentKeys.stats(),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<AssignmentStats>>('/assignments/stats');
      return data.data;
    },
    staleTime: 60_000,
  });
}

export function useAssignmentLabels() {
  return useQuery({
    queryKey: assignmentKeys.labels(),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<string[]>>('/assignments/labels');
      return data.data;
    },
    staleTime: 5 * 60_000,
  });
}

/** Invalidates every derived view after a write. */
function useInvalidateAssignments() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: assignmentKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['subjects'] });
  };
}

export function useCreateAssignment() {
  const invalidate = useInvalidateAssignments();

  return useMutation({
    mutationFn: async (body: CreateAssignmentBody) => {
      const { data } = await apiClient.post<ApiEnvelope<Assignment>>('/assignments', body);
      return data.data;
    },
    onSuccess: (assignment) => {
      invalidate();
      toast.success(`"${assignment.title}" created`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useUpdateAssignment() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateAssignments();

  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateAssignmentBody }) => {
      const { data } = await apiClient.patch<ApiEnvelope<Assignment>>(
        `/assignments/${id}`,
        body,
      );
      return data.data;
    },

    // Optimistic update: checking off a task should feel instant.
    onMutate: async ({ id, body }) => {
      await queryClient.cancelQueries({ queryKey: assignmentKeys.lists() });
      const snapshot = queryClient.getQueriesData<AssignmentListResult>({
        queryKey: assignmentKeys.lists(),
      });

      queryClient.setQueriesData<AssignmentListResult>(
        { queryKey: assignmentKeys.lists() },
        (current) =>
          current
            ? {
                ...current,
                items: current.items.map((item) =>
                  item.id === id ? { ...item, ...body } : item,
                ),
              }
            : current,
      );

      return { snapshot };
    },

    onError: (error, _variables, context) => {
      // Roll back to exactly what was on screen before.
      context?.snapshot.forEach(([key, value]) => queryClient.setQueryData(key, value));
      toast.error(apiErrorMessage(error));
    },

    onSettled: () => invalidate(),
  });
}

export function useDeleteAssignment() {
  const invalidate = useInvalidateAssignments();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/assignments/${id}`);
      return id;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Assignment deleted');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useBulkUpdateAssignments() {
  const invalidate = useInvalidateAssignments();

  return useMutation({
    mutationFn: async (body: {
      ids: string[];
      status?: Assignment['status'];
      priority?: Assignment['priority'];
      subjectId?: string | null;
    }) => {
      const { data } = await apiClient.patch<ApiEnvelope<{ updated: number }>>(
        '/assignments/bulk',
        body,
      );
      return data.data;
    },
    onSuccess: (result) => {
      invalidate();
      toast.success(`${result.updated} assignment${result.updated === 1 ? '' : 's'} updated`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}
