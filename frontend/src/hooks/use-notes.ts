'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import type {
  ApiEnvelope,
  ApiPaginatedEnvelope,
  CreateNoteBody,
  Note,
  NoteFilters,
  NoteFolder,
  NoteShare,
  NoteSummaryResult,
  NoteVersion,
  Pagination,
  SharePermission,
  UpdateNoteBody,
} from '@/types/api';

export const noteKeys = {
  all: ['notes'] as const,
  lists: () => [...noteKeys.all, 'list'] as const,
  list: (filters: NoteFilters) => [...noteKeys.lists(), filters] as const,
  detail: (id: string) => [...noteKeys.all, 'detail', id] as const,
  versions: (id: string) => [...noteKeys.all, 'versions', id] as const,
  shares: (id: string) => [...noteKeys.all, 'shares', id] as const,
  tags: () => [...noteKeys.all, 'tags'] as const,
  folders: () => ['note-folders'] as const,
};

function toParams(filters: NoteFilters): Record<string, string | number | boolean> {
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

export interface NoteListResult {
  items: Note[];
  pagination: Pagination;
}

export function useNotes(filters: NoteFilters) {
  return useQuery({
    queryKey: noteKeys.list(filters),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiPaginatedEnvelope<Note>>('/notes', {
        params: toParams(filters),
      });
      return { items: data.data, pagination: data.pagination } satisfies NoteListResult;
    },
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useNote(id: string | null) {
  return useQuery({
    queryKey: noteKeys.detail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<Note>>(`/notes/${id}`);
      return data.data;
    },
    enabled: Boolean(id),
  });
}

export function useNoteTags() {
  return useQuery({
    queryKey: noteKeys.tags(),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<string[]>>('/notes/tags');
      return data.data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useNoteFolders() {
  return useQuery({
    queryKey: noteKeys.folders(),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<NoteFolder[]>>('/note-folders');
      return data.data;
    },
    staleTime: 5 * 60_000,
  });
}

function useInvalidateNotes() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: noteKeys.all });
    void queryClient.invalidateQueries({ queryKey: noteKeys.folders() });
  };
}

export function useCreateNote() {
  const invalidate = useInvalidateNotes();

  return useMutation({
    mutationFn: async (body: CreateNoteBody) => {
      const { data } = await apiClient.post<ApiEnvelope<Note>>('/notes', body);
      return data.data;
    },
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useUpdateNote() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateNotes();

  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateNoteBody }) => {
      const { data } = await apiClient.patch<ApiEnvelope<Note>>(`/notes/${id}`, body);
      return data.data;
    },

    // Optimistic so toggling a favourite or renaming feels immediate.
    onMutate: async ({ id, body }) => {
      await queryClient.cancelQueries({ queryKey: noteKeys.lists() });
      const snapshot = queryClient.getQueriesData<NoteListResult>({
        queryKey: noteKeys.lists(),
      });

      queryClient.setQueriesData<NoteListResult>(
        { queryKey: noteKeys.lists() },
        (current) =>
          current
            ? {
                ...current,
                items: current.items.map((note) =>
                  note.id === id ? { ...note, ...body } : note,
                ),
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

/**
 * Autosave. Deliberately silent — no toasts, no cache invalidation, since it
 * fires while the user is still typing and must not disturb the editor.
 */
export function useAutosaveNote() {
  return useMutation({
    mutationFn: async ({
      id,
      content,
      title,
    }: {
      id: string;
      content: string;
      title?: string;
    }) => {
      const { data } = await apiClient.put<
        ApiEnvelope<{ id: string; updatedAt: string; wordCount: number }>
      >(`/notes/${id}/autosave`, { content, ...(title ? { title } : {}) });
      return data.data;
    },
  });
}

export function useDeleteNote() {
  const invalidate = useInvalidateNotes();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/notes/${id}`);
      return id;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Note moved to trash');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useRestoreNote() {
  const invalidate = useInvalidateNotes();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<ApiEnvelope<Note>>(`/notes/${id}/restore`);
      return data.data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Note restored');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function usePurgeNote() {
  const invalidate = useInvalidateNotes();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/notes/${id}/purge`);
      return id;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Note permanently deleted');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useToggleFavorite() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateNotes();

  return useMutation({
    mutationFn: async ({ id, favorite }: { id: string; favorite: boolean }) => {
      const { data } = await apiClient.patch<ApiEnvelope<Note>>(`/notes/${id}/favorite`, {
        favorite,
      });
      return data.data;
    },

    onMutate: async ({ id, favorite }) => {
      await queryClient.cancelQueries({ queryKey: noteKeys.lists() });
      const snapshot = queryClient.getQueriesData<NoteListResult>({
        queryKey: noteKeys.lists(),
      });

      queryClient.setQueriesData<NoteListResult>(
        { queryKey: noteKeys.lists() },
        (current) =>
          current
            ? {
                ...current,
                items: current.items.map((note) =>
                  note.id === id ? { ...note, favorite } : note,
                ),
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

export function useArchiveNote() {
  const invalidate = useInvalidateNotes();

  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { data } = await apiClient.patch<ApiEnvelope<Note>>(`/notes/${id}/archive`, {
        archived,
      });
      return data.data;
    },
    onSuccess: (_note, { archived }) => {
      invalidate();
      toast.success(archived ? 'Note archived' : 'Note unarchived');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

// --- Versions ---------------------------------------------------------------

export function useNoteVersions(noteId: string | null) {
  return useQuery({
    queryKey: noteKeys.versions(noteId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<NoteVersion[]>>(
        `/notes/${noteId}/versions`,
      );
      return data.data;
    },
    enabled: Boolean(noteId),
  });
}

export function useRestoreVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ noteId, versionId }: { noteId: string; versionId: string }) => {
      const { data } = await apiClient.post<ApiEnvelope<Note>>(
        `/notes/${noteId}/versions/${versionId}/restore`,
      );
      return data.data;
    },
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: noteKeys.all });
      toast.success(`Restored "${note.title}"`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

// --- Sharing ----------------------------------------------------------------

export function useNoteShares(noteId: string | null) {
  return useQuery({
    queryKey: noteKeys.shares(noteId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<NoteShare[]>>(`/notes/${noteId}/shares`);
      return data.data;
    },
    enabled: Boolean(noteId),
  });
}

export function useShareNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      noteId,
      ...body
    }: {
      noteId: string;
      sharedWithId?: string | null;
      permission: SharePermission;
      createLink?: boolean;
    }) => {
      const { data } = await apiClient.post<ApiEnvelope<NoteShare>>(
        `/notes/${noteId}/shares`,
        body,
      );
      return data.data;
    },
    onSuccess: (_share, { noteId }) => {
      void queryClient.invalidateQueries({ queryKey: noteKeys.shares(noteId) });
      toast.success('Sharing updated');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useSummariseNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (noteId: string) => {
      const { data } = await apiClient.post<ApiEnvelope<NoteSummaryResult>>(
        `/notes/${noteId}/summarise`,
      );
      return data.data;
    },
    onSuccess: (_result, noteId) => {
      void queryClient.invalidateQueries({ queryKey: noteKeys.detail(noteId) });
      toast.success('Summary generated');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

// --- Folders ----------------------------------------------------------------

export function useCreateFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: { name: string; color?: string | null; parentId?: string | null }) => {
      const { data } = await apiClient.post<ApiEnvelope<NoteFolder>>('/note-folders', body);
      return data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: noteKeys.folders() });
      toast.success('Folder created');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

export function useDeleteFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/note-folders/${id}`);
      return id;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: noteKeys.folders() });
      void queryClient.invalidateQueries({ queryKey: noteKeys.all });
      toast.success('Folder deleted');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}
