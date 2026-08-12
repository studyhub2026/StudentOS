'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

interface GroupResource {
  id: string;
  type: string;
  title: string;
  url: string | null;
  createdAt: string;
  user: { id: string; name: string; username: string };
}

interface GroupTask {
  id: string;
  title: string;
  completed: boolean;
  dueAt: string | null;
  createdAt: string;
  creator: { id: string; name: string; username: string };
}

interface PollOption {
  text: string;
  votes: string[];
}

interface GroupPoll {
  id: string;
  question: string;
  options: PollOption[];
  closedAt: string | null;
  createdAt: string;
  user: { id: string; name: string; username: string };
}

export function useGroupResources(groupId: string) {
  return useQuery<GroupResource[]>({
    queryKey: ['group-resources', groupId],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<GroupResource[]>>(`/groups/${groupId}/resources`);
      return data.data;
    },
    staleTime: 30_000,
  });
}

export function useAddResource(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { type: string; title: string; url?: string }) => {
      const { data } = await apiClient.post<ApiEnvelope<GroupResource>>(`/groups/${groupId}/resources`, input);
      return data.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['group-resources', groupId] }),
  });
}

export function useDeleteResource(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (resourceId: string) => {
      await apiClient.delete(`/groups/${groupId}/resources/${resourceId}`);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['group-resources', groupId] }),
  });
}

export function useGroupTasks(groupId: string) {
  return useQuery<GroupTask[]>({
    queryKey: ['group-tasks', groupId],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<GroupTask[]>>(`/groups/${groupId}/tasks`);
      return data.data;
    },
    staleTime: 30_000,
  });
}

export function useAddTask(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title: string; dueAt?: string }) => {
      const { data } = await apiClient.post<ApiEnvelope<GroupTask>>(`/groups/${groupId}/tasks`, input);
      return data.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['group-tasks', groupId] }),
  });
}

export function useToggleTask(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const { data } = await apiClient.patch<ApiEnvelope<{ id: string; completed: boolean }>>(`/groups/${groupId}/tasks/${taskId}`);
      return data.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['group-tasks', groupId] }),
  });
}

export function useDeleteTask(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      await apiClient.delete(`/groups/${groupId}/tasks/${taskId}`);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['group-tasks', groupId] }),
  });
}

export function useGroupPolls(groupId: string) {
  return useQuery<GroupPoll[]>({
    queryKey: ['group-polls', groupId],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<GroupPoll[]>>(`/groups/${groupId}/polls`);
      return data.data;
    },
    staleTime: 30_000,
  });
}

export function useCreatePoll(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { question: string; options: string[] }) => {
      const { data } = await apiClient.post<ApiEnvelope<GroupPoll>>(`/groups/${groupId}/polls`, input);
      return data.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['group-polls', groupId] }),
  });
}

export function useVotePoll(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pollId, optionIndex }: { pollId: string; optionIndex: number }) => {
      const { data } = await apiClient.post<ApiEnvelope<GroupPoll>>(`/groups/${groupId}/polls/${pollId}/vote`, { optionIndex });
      return data.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['group-polls', groupId] }),
  });
}

export function useClosePoll(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pollId: string) => {
      await apiClient.post(`/groups/${groupId}/polls/${pollId}/close`);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['group-polls', groupId] }),
  });
}
