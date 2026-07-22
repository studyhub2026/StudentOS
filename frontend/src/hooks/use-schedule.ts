'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import type {
  Analytics,
  ApiEnvelope,
  ApiPaginatedEnvelope,
  CreateBlockBody,
  FocusSession,
  Pagination,
  ScheduleBlock,
  StudyPlan,
  WeekSchedule,
} from '@/types/api';

export const scheduleKeys = {
  all: ['schedule'] as const,
  week: (weekStart: string | undefined) => [...scheduleKeys.all, 'week', weekStart ?? 'current'] as const,
  range: (from: string, to: string) => [...scheduleKeys.all, 'range', from, to] as const,
};

export function useWeekSchedule(weekStart?: string) {
  return useQuery({
    queryKey: scheduleKeys.week(weekStart),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<WeekSchedule>>('/schedule/week', {
        params: weekStart ? { weekStart } : {},
      });
      return data.data;
    },
    staleTime: 30_000,
  });
}

function useInvalidateSchedule() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useCreateBlock() {
  const invalidate = useInvalidateSchedule();

  return useMutation({
    mutationFn: async (body: CreateBlockBody) => {
      const { data } = await apiClient.post<ApiEnvelope<ScheduleBlock>>('/schedule', body);
      return data.data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Block added');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useUpdateBlock() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateSchedule();

  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Partial<CreateBlockBody> }) => {
      const { data } = await apiClient.patch<ApiEnvelope<ScheduleBlock>>(`/schedule/${id}`, body);
      return data.data;
    },

    // Optimistic so dragging a block to a new time feels instant.
    onMutate: async ({ id, body }) => {
      await queryClient.cancelQueries({ queryKey: scheduleKeys.all });
      const snapshot = queryClient.getQueriesData<WeekSchedule>({ queryKey: scheduleKeys.all });

      queryClient.setQueriesData<WeekSchedule>({ queryKey: scheduleKeys.all }, (current) =>
        current
          ? {
              ...current,
              days: current.days.map((day) => ({
                ...day,
                blocks: day.blocks.map((block) =>
                  block.id === id ? { ...block, ...body } : block,
                ),
              })),
            }
          : current,
      );

      return { snapshot };
    },

    onError: (error, _variables, context) => {
      context?.snapshot.forEach(([key, value]) => queryClient.setQueryData(key, value));
      toast.error(apiErrorMessage(error));
    },

    onSettled: () => invalidate(),
  });
}

export function useDeleteBlock() {
  const invalidate = useInvalidateSchedule();

  return useMutation({
    mutationFn: async ({ id, scope }: { id: string; scope?: 'one' | 'following' | 'all' }) => {
      const { data } = await apiClient.delete<ApiEnvelope<{ deleted: number }>>(
        `/schedule/${id}`,
        { params: { scope: scope ?? 'one' } },
      );
      return data.data;
    },
    onSuccess: (result) => {
      invalidate();
      toast.success(`${result.deleted} block${result.deleted === 1 ? '' : 's'} removed`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

// --- Planner ----------------------------------------------------------------

export function useGeneratePlan() {
  return useMutation({
    mutationFn: async (body: {
      days: number;
      dayStartHour: number;
      dayEndHour: number;
      maxSessionMinutes: number;
      minSessionMinutes: number;
      includeAdvice: boolean;
    }) => {
      const { data } = await apiClient.post<ApiEnvelope<StudyPlan>>('/planner/generate', body);
      return data.data;
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useApplyPlan() {
  const invalidate = useInvalidateSchedule();

  return useMutation({
    mutationFn: async (body: {
      sessions: {
        taskId: string;
        title: string;
        startAt: string;
        endAt: string;
        subjectId?: string | null;
      }[];
      replaceExisting?: boolean;
      from?: string;
      to?: string;
    }) => {
      const { data } = await apiClient.post<ApiEnvelope<{ created: number }>>(
        '/planner/apply',
        body,
      );
      return data.data;
    },
    onSuccess: (result) => {
      invalidate();
      toast.success(`${result.created} sessions added to your timetable`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

// --- Focus ------------------------------------------------------------------

export function useActiveSession() {
  return useQuery({
    queryKey: ['focus', 'active'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<FocusSession | null>>('/focus/active');
      return data.data;
    },
    staleTime: 10_000,
  });
}

export function useStartSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: {
      type: string;
      subjectId?: string | null;
      assignmentId?: string | null;
      ambientSound?: string | null;
    }) => {
      const { data } = await apiClient.post<ApiEnvelope<FocusSession>>('/focus/start', body);
      return data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['focus'] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useEndSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      completed,
      interruptions,
    }: {
      id: string;
      completed: boolean;
      interruptions?: number;
    }) => {
      const { data } = await apiClient.post<ApiEnvelope<FocusSession>>(`/focus/${id}/end`, {
        completed,
        ...(interruptions === undefined ? {} : { interruptions }),
      });
      return data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['focus'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useCancelSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/focus/${id}`);
      return id;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['focus'] });
    },
  });
}

export function useFocusSessions(page = 1) {
  return useQuery({
    queryKey: ['focus', 'sessions', page],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiPaginatedEnvelope<FocusSession>>(
        '/focus/sessions',
        { params: { page, limit: 20 } },
      );
      return { items: data.data, pagination: data.pagination } as {
        items: FocusSession[];
        pagination: Pagination;
      };
    },
    placeholderData: (previous) => previous,
  });
}

// --- Analytics --------------------------------------------------------------

export function useAnalytics(days = 30) {
  return useQuery({
    queryKey: ['analytics', days],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<Analytics>>('/analytics', {
        params: { days },
      });
      return data.data;
    },
    staleTime: 60_000,
  });
}
