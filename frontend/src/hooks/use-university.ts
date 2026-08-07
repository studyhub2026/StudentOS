'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  ApiEnvelope,
  ApiPaginatedEnvelope,
  Conflict,
  CreateConnectionBody,
  Diagnostics,
  LmsAnnouncementItem,
  LmsConnection,
  LmsCourse,
  LmsFileItem,
  LmsGradeItem,
  LmsProviderPublicMeta,
  OAuthStartResponse,
  QueueStatus,
  ResolutionAction,
  SyncLog,
  SyncPreview,
  UniversityDashboard,
} from '@/types/api';

const KEYS = {
  connections: ['university', 'connections'] as const,
  dashboard: ['university', 'dashboard'] as const,
  syncLogs: ['university', 'sync-logs'] as const,
  courses: ['university', 'courses'] as const,
  announcements: ['university', 'announcements'] as const,
  grades: ['university', 'grades'] as const,
  files: ['university', 'files'] as const,
  queueStatus: ['university', 'queue-status'] as const,
  providers: ['university', 'providers'] as const,
  diagnostics: ['university', 'diagnostics'] as const,
  conflicts: ['university', 'conflicts'] as const,
  conflict: (id: string) => ['university', 'conflict', id] as const,
  preview: (id: string) => ['university', 'preview', id] as const,
};

export function useLmsProviders() {
  return useQuery({
    queryKey: KEYS.providers,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<LmsProviderPublicMeta[]>>(
        '/university/providers',
      );
      return data.data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useDiagnostics() {
  return useQuery({
    queryKey: KEYS.diagnostics,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<Diagnostics>>('/university/diagnostics');
      return data.data;
    },
    refetchInterval: 15_000,
  });
}

export function useCreatePreview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (connectionId: string) => {
      const { data } = await apiClient.post<ApiEnvelope<SyncPreview>>(
        `/university/${connectionId}/preview`,
      );
      return data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.dashboard }),
  });
}

export function usePreview(previewId: string | null) {
  return useQuery({
    queryKey: previewId ? KEYS.preview(previewId) : ['university', 'preview', 'none'],
    enabled: Boolean(previewId),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<SyncPreview>>(
        `/university/preview/${previewId}`,
      );
      return data.data;
    },
  });
}

export function useApprovePreview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (previewId: string) => {
      const { data } = await apiClient.post<
        ApiEnvelope<{ jobId?: string; syncLogId?: string }>
      >(`/university/preview/${previewId}/approve`);
      return data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.connections });
      qc.invalidateQueries({ queryKey: KEYS.dashboard });
    },
  });
}

export function useCancelPreview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (previewId: string) => {
      await apiClient.delete(`/university/preview/${previewId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.dashboard }),
  });
}

export function useConflicts(status: 'PENDING' | 'RESOLVED' | 'IGNORED' | 'ALL' = 'PENDING') {
  return useQuery({
    queryKey: [...KEYS.conflicts, status],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<Conflict[]>>(
        `/university/conflicts?status=${status}`,
      );
      return data.data;
    },
  });
}

export function useConflict(id: string | null) {
  return useQuery({
    queryKey: id ? KEYS.conflict(id) : ['university', 'conflict', 'none'],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<Conflict>>(`/university/conflicts/${id}`);
      return data.data;
    },
  });
}

export function useResolveConflict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      action: ResolutionAction;
      mergedData?: Record<string, unknown>;
    }) => {
      const { data } = await apiClient.patch<ApiEnvelope<Conflict>>(
        `/university/conflicts/${input.id}`,
        { action: input.action, mergedData: input.mergedData },
      );
      return data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.conflicts });
      qc.invalidateQueries({ queryKey: KEYS.dashboard });
    },
  });
}

export function useUndoConflict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<ApiEnvelope<Conflict>>(
        `/university/conflicts/${id}/undo`,
      );
      return data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.conflicts });
      qc.invalidateQueries({ queryKey: KEYS.dashboard });
    },
  });
}

export function useQueueStatus() {
  return useQuery({
    queryKey: KEYS.queueStatus,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<QueueStatus>>('/university/queue-status');
      return data.data;
    },
    refetchInterval: 5_000,
  });
}

export function useStartOAuth() {
  return useMutation({
    mutationFn: async (input: {
      provider: 'canvas' | 'moodle' | 'blackboard' | 'brightspace' | 'sakai' | 'google-classroom' | 'ms-teams';
      portalUrl: string;
      displayName: string;
    }) => {
      const { data } = await apiClient.post<ApiEnvelope<OAuthStartResponse>>(
        `/university/oauth/${input.provider}/start`,
        { portalUrl: input.portalUrl, displayName: input.displayName },
      );
      return data.data;
    },
  });
}

export function useUniversityDashboard() {
  return useQuery({
    queryKey: KEYS.dashboard,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<UniversityDashboard>>(
        '/university/dashboard',
      );
      return data.data;
    },
  });
}

export function useLmsConnections() {
  return useQuery({
    queryKey: KEYS.connections,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<LmsConnection[]>>('/university');
      return data.data;
    },
  });
}

export function useCreateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateConnectionBody) => {
      const { data } = await apiClient.post<ApiEnvelope<LmsConnection>>('/university', body);
      return data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.connections });
      qc.invalidateQueries({ queryKey: KEYS.dashboard });
    },
  });
}

export function useUpdateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & Partial<CreateConnectionBody>) => {
      const { data } = await apiClient.patch<ApiEnvelope<LmsConnection>>(
        `/university/${id}`,
        body,
      );
      return data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.connections });
      qc.invalidateQueries({ queryKey: KEYS.dashboard });
    },
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/university/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.connections });
      qc.invalidateQueries({ queryKey: KEYS.dashboard });
      qc.invalidateQueries({ queryKey: KEYS.courses });
    },
  });
}

export function useTriggerSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (connectionId: string) => {
      const { data } = await apiClient.post<ApiEnvelope<{ syncLogId: string }>>(
        `/university/${connectionId}/sync`,
      );
      return data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.connections });
      qc.invalidateQueries({ queryKey: KEYS.dashboard });
      qc.invalidateQueries({ queryKey: KEYS.syncLogs });
      qc.invalidateQueries({ queryKey: KEYS.courses });
      qc.invalidateQueries({ queryKey: KEYS.announcements });
      qc.invalidateQueries({ queryKey: KEYS.grades });
      qc.invalidateQueries({ queryKey: KEYS.files });
    },
  });
}

export function useAutoSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<
        ApiEnvelope<{ synced: number; results: { connectionId: string; syncLogId: string }[] }>
      >('/university/auto-sync');
      return data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.connections });
      qc.invalidateQueries({ queryKey: KEYS.dashboard });
      qc.invalidateQueries({ queryKey: KEYS.syncLogs });
    },
  });
}

export function useSyncLogs(connectionId?: string) {
  return useQuery({
    queryKey: [...KEYS.syncLogs, connectionId],
    queryFn: async () => {
      const params = connectionId ? `?connectionId=${connectionId}` : '';
      const { data } = await apiClient.get<ApiPaginatedEnvelope<SyncLog>>(
        `/university/sync-logs${params}`,
      );
      return data.data;
    },
  });
}

export function useLmsCourses(connectionId?: string) {
  return useQuery({
    queryKey: [...KEYS.courses, connectionId],
    queryFn: async () => {
      const params = connectionId ? `?connectionId=${connectionId}` : '';
      const { data } = await apiClient.get<ApiEnvelope<LmsCourse[]>>(
        `/university/courses${params}`,
      );
      return data.data;
    },
  });
}

export function useLmsAnnouncements(courseId?: string) {
  return useQuery({
    queryKey: [...KEYS.announcements, courseId],
    queryFn: async () => {
      const params = courseId ? `?courseId=${courseId}` : '';
      const { data } = await apiClient.get<ApiEnvelope<LmsAnnouncementItem[]>>(
        `/university/announcements${params}`,
      );
      return data.data;
    },
  });
}

export function useLmsGrades(courseId?: string) {
  return useQuery({
    queryKey: [...KEYS.grades, courseId],
    queryFn: async () => {
      const params = courseId ? `?courseId=${courseId}` : '';
      const { data } = await apiClient.get<ApiEnvelope<LmsGradeItem[]>>(
        `/university/grades${params}`,
      );
      return data.data;
    },
  });
}

export function useLmsFiles(courseId?: string) {
  return useQuery({
    queryKey: [...KEYS.files, courseId],
    queryFn: async () => {
      const params = courseId ? `?courseId=${courseId}` : '';
      const { data } = await apiClient.get<ApiEnvelope<LmsFileItem[]>>(
        `/university/files${params}`,
      );
      return data.data;
    },
  });
}
