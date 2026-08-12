'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import type {
  AdminGroup,
  AdminMessage,
  AdminOverview,
  AdminUser,
  AdminUserDetail,
  ActivityLogEntry,
  ApiEnvelope,
  ApiPaginatedEnvelope,
  Pagination,
  Role,
  SystemHealth,
} from '@/types/api';

export const adminKeys = {
  all: ['admin'] as const,
  overview: (days: number) => [...adminKeys.all, 'overview', days] as const,
  users: (filters: AdminUserFilters) => [...adminKeys.all, 'users', filters] as const,
  user: (id: string) => [...adminKeys.all, 'user', id] as const,
  logs: (page: number, action?: string) => [...adminKeys.all, 'logs', page, action ?? ''] as const,
  messages: () => [...adminKeys.all, 'messages'] as const,
  groups: () => [...adminKeys.all, 'groups'] as const,
  health: () => [...adminKeys.all, 'health'] as const,
};

export interface AdminUserFilters {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'lastActiveDate' | 'name' | 'email' | 'totalXp';
  sortOrder?: 'asc' | 'desc';
  role?: Role;
  status?: 'active' | 'suspended' | 'unverified';
  search?: string;
}

function params(filters: object): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    output[key] = value as string | number | boolean;
  }
  return output;
}

export function useAdminOverview(days = 30) {
  return useQuery({
    queryKey: adminKeys.overview(days),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<AdminOverview>>('/admin/overview', {
        params: { days },
      });
      return data.data;
    },
    staleTime: 60_000,
  });
}

export function useAdminUsers(filters: AdminUserFilters) {
  return useQuery({
    queryKey: adminKeys.users(filters),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiPaginatedEnvelope<AdminUser>>('/admin/users', {
        params: params(filters),
      });
      return { items: data.data, pagination: data.pagination } as {
        items: AdminUser[];
        pagination: Pagination;
      };
    },
    placeholderData: (previous) => previous,
  });
}

export function useAdminUser(id: string | null) {
  return useQuery({
    queryKey: adminKeys.user(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<AdminUserDetail>>(`/admin/users/${id}`);
      return data.data;
    },
    enabled: Boolean(id),
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: adminKeys.health(),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<SystemHealth>>('/admin/health');
      return data.data;
    },
    // Health is only useful when it is current.
    refetchInterval: 30_000,
    staleTime: 0,
  });
}

export function useActivityLogs(page: number, action?: string) {
  return useQuery({
    queryKey: adminKeys.logs(page, action),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiPaginatedEnvelope<ActivityLogEntry>>(
        '/admin/logs',
        { params: params({ page, limit: 50, action }) },
      );
      return { items: data.data, pagination: data.pagination } as {
        items: ActivityLogEntry[];
        pagination: Pagination;
      };
    },
    placeholderData: (previous) => previous,
  });
}

export function useAdminMessages(groupId?: string) {
  return useQuery({
    queryKey: [...adminKeys.messages(), groupId ?? 'all'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<AdminMessage[]>>('/admin/messages', {
        params: params({ limit: 50, groupId }),
      });
      return data.data;
    },
  });
}

export function useAdminGroups(search?: string) {
  return useQuery({
    queryKey: [...adminKeys.groups(), search ?? ''],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<AdminGroup[]>>('/admin/groups', {
        params: params({ limit: 50, search }),
      });
      return data.data;
    },
  });
}

function useInvalidateAdmin() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.all });
  };
}

export function useChangeUserRole() {
  const invalidate = useInvalidateAdmin();

  return useMutation({
    mutationFn: async ({ id, role }: { id: string; role: Role }) => {
      await apiClient.patch(`/admin/users/${id}/role`, { role });
      return { id, role };
    },
    onSuccess: ({ role }) => {
      invalidate();
      toast.success(`Role changed to ${role}`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useSuspendUser() {
  const invalidate = useInvalidateAdmin();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      await apiClient.post(`/admin/users/${id}/suspend`, { ...(reason ? { reason } : {}) });
      return id;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Account suspended and signed out everywhere');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useReinstateUser() {
  const invalidate = useInvalidateAdmin();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/admin/users/${id}/reinstate`);
      return id;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Account reinstated');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useRevokeUserSessions() {
  const invalidate = useInvalidateAdmin();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<ApiEnvelope<{ revoked: number }>>(
        `/admin/users/${id}/revoke-sessions`,
      );
      return data.data;
    },
    onSuccess: (result) => {
      invalidate();
      toast.success(`${result.revoked} session${result.revoked === 1 ? '' : 's'} revoked`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useModerateMessage() {
  const invalidate = useInvalidateAdmin();

  return useMutation({
    mutationFn: async ({ messageId, reason }: { messageId: string; reason?: string }) => {
      await apiClient.delete(`/admin/messages/${messageId}`, {
        data: { ...(reason ? { reason } : {}) },
      });
      return messageId;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Message removed');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

interface SyncLogEntry {
  id: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  assignmentsCreated: number;
  gradesCreated: number;
  errors: string | null;
  connection: {
    id: string;
    provider: string;
    user: { id: string; name: string; username: string };
  };
}

interface UniversityOverview {
  totalConnections: number;
  activeConnections: number;
  recentSyncs: SyncLogEntry[];
  failedSyncs7d: number;
}

export function useUniversityOverview() {
  return useQuery({
    queryKey: ['admin', 'university'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<UniversityOverview>>('/admin/university');
      return data.data;
    },
    staleTime: 30_000,
  });
}
