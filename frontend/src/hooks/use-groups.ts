'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import type {
  ApiEnvelope,
  GroupDetail,
  GroupSummary,
  MessagePage,
  PublicGroup,
} from '@/types/api';

export const groupKeys = {
  all: ['groups'] as const,
  list: () => [...groupKeys.all, 'list'] as const,
  detail: (id: string) => [...groupKeys.all, 'detail', id] as const,
  messages: (groupId: string, channelId: string) =>
    [...groupKeys.all, 'messages', groupId, channelId] as const,
  discover: (search: string) => [...groupKeys.all, 'discover', search] as const,
};

export function useGroups() {
  return useQuery({
    queryKey: groupKeys.list(),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<GroupSummary[]>>('/groups');
      return data.data;
    },
    staleTime: 30_000,
  });
}

export function useGroup(id: string | null) {
  return useQuery({
    queryKey: groupKeys.detail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<GroupDetail>>(`/groups/${id}`);
      return data.data;
    },
    enabled: Boolean(id),
  });
}

export function useDiscoverGroups(search: string) {
  return useQuery({
    queryKey: groupKeys.discover(search),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<PublicGroup[]>>('/groups/discover', {
        params: search ? { search } : {},
      });
      return data.data;
    },
    staleTime: 60_000,
  });
}

/**
 * Message history. Live messages arrive over the socket and are appended
 * directly to this cache, so the list is never refetched mid-conversation.
 */
export function useMessages(groupId: string | null, channelId: string | null) {
  return useQuery({
    queryKey: groupKeys.messages(groupId ?? '', channelId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<MessagePage>>(
        `/groups/${groupId}/channels/${channelId}/messages`,
        { params: { limit: 50 } },
      );
      return data.data;
    },
    enabled: Boolean(groupId && channelId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: { name: string; description?: string; isPublic?: boolean }) => {
      const { data } = await apiClient.post<ApiEnvelope<GroupDetail>>('/groups', body);
      return data.data;
    },
    onSuccess: (group) => {
      void queryClient.invalidateQueries({ queryKey: groupKeys.all });
      toast.success(`"${group.name}" created`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useJoinGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inviteCode: string) => {
      const { data } = await apiClient.post<ApiEnvelope<{ groupId: string; name: string }>>(
        '/groups/join',
        { inviteCode },
      );
      return data.data;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: groupKeys.all });
      toast.success(`Joined "${result.name}"`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useLeaveGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (groupId: string) => {
      await apiClient.post(`/groups/${groupId}/leave`);
      return groupId;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: groupKeys.all });
      toast.success('You left the group');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useCreateChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ groupId, name }: { groupId: string; name: string }) => {
      const { data } = await apiClient.post(`/groups/${groupId}/channels`, { name });
      return data;
    },
    onSuccess: (_result, { groupId }) => {
      void queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) });
      toast.success('Channel created');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useDeleteMessage() {
  return useMutation({
    mutationFn: async ({ groupId, messageId }: { groupId: string; messageId: string }) => {
      await apiClient.delete(`/groups/${groupId}/messages/${messageId}`);
      return messageId;
    },
    // The socket broadcast removes it from the cache, so no invalidation here.
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}
