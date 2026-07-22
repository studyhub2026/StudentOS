'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type { ApiEnvelope, Attachment, SignedUpload, UploadFolder } from '@/types/api';

export function useUploadStatus() {
  return useQuery({
    queryKey: ['uploads', 'status'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<{ configured: boolean }>>(
        '/uploads/status',
      );
      return data.data;
    },
    staleTime: 10 * 60_000,
  });
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

/**
 * Direct browser → Cloudinary upload.
 *
 * The API mints a short-lived signature; the file itself never passes through
 * our server. XHR rather than fetch, because fetch still cannot report upload
 * progress.
 */
function uploadToCloudinary(
  signed: SignedUpload,
  file: File,
  onProgress: (progress: UploadProgress) => void,
): Promise<{
  public_id: string;
  secure_url: string;
  bytes: number;
  format?: string;
  width?: number;
  height?: number;
}> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    form.append('api_key', signed.apiKey);
    form.append('timestamp', String(signed.timestamp));
    form.append('public_id', signed.publicId);
    form.append('signature', signed.signature);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', signed.uploadUrl);

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      onProgress({
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100),
      });
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Cloudinary returned a malformed response'));
        }
      } else {
        let message = `Upload failed (${xhr.status})`;
        try {
          message = JSON.parse(xhr.responseText)?.error?.message ?? message;
        } catch {
          // Keep the status-code message.
        }
        reject(new Error(message));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

    xhr.send(form);
  });
}

export interface UploadTarget {
  assignmentId?: string;
  noteId?: string;
  messageId?: string;
}

export function useFileUpload(folder: UploadFolder, target: UploadTarget = {}) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      setProgress({ loaded: 0, total: file.size, percent: 0 });

      const { data: signResponse } = await apiClient.post<ApiEnvelope<SignedUpload>>(
        '/uploads/sign',
        { folder },
      );
      const signed = signResponse.data;

      // Checked client-side purely for a fast, clear message; the server
      // enforces the same policy and is the authority.
      if (file.size > signed.maxBytes) {
        throw new Error(
          `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit here is ${Math.round(signed.maxBytes / 1024 / 1024)}MB.`,
        );
      }

      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (extension && !signed.allowedFormats.includes(extension)) {
        throw new Error(
          `.${extension} files are not allowed here. Accepted: ${signed.allowedFormats.join(', ')}.`,
        );
      }

      const uploaded = await uploadToCloudinary(signed, file, setProgress);

      const { data: registered } = await apiClient.post<ApiEnvelope<Attachment>>(
        '/uploads/register',
        {
          folder,
          publicId: uploaded.public_id,
          url: uploaded.secure_url,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: uploaded.bytes,
          ...(uploaded.format ? { format: uploaded.format } : {}),
          ...(uploaded.width ? { width: uploaded.width } : {}),
          ...(uploaded.height ? { height: uploaded.height } : {}),
          ...target,
        },
      );

      return registered.data;
    },

    onSuccess: () => {
      setProgress(null);
      void queryClient.invalidateQueries({ queryKey: ['assignments'] });
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      toast.success('File uploaded');
    },

    onError: (error) => {
      setProgress(null);
      toast.error(error instanceof Error ? error.message : apiErrorMessage(error));
    },
  });

  return { ...mutation, progress };
}

/** Avatar upload, which additionally updates the signed-in user. */
export function useAvatarUpload() {
  const setUser = useAuthStore((state) => state.setUser);
  const user = useAuthStore((state) => state.user);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      setProgress({ loaded: 0, total: file.size, percent: 0 });

      const { data: signResponse } = await apiClient.post<ApiEnvelope<SignedUpload>>(
        '/uploads/sign',
        { folder: 'avatars' },
      );
      const signed = signResponse.data;

      if (file.size > signed.maxBytes) {
        throw new Error(`Avatars must be under ${Math.round(signed.maxBytes / 1024 / 1024)}MB.`);
      }

      const uploaded = await uploadToCloudinary(signed, file, setProgress);

      const { data } = await apiClient.post<ApiEnvelope<{ id: string; avatarUrl: string }>>(
        '/uploads/avatar',
        {
          folder: 'avatars',
          publicId: uploaded.public_id,
          url: uploaded.secure_url,
          filename: file.name,
          mimeType: file.type || 'image/png',
          sizeBytes: uploaded.bytes,
          ...(uploaded.format ? { format: uploaded.format } : {}),
        },
      );

      return data.data;
    },

    onSuccess: (result) => {
      setProgress(null);
      if (user) setUser({ ...user, avatarUrl: result.avatarUrl });
      toast.success('Avatar updated');
    },

    onError: (error) => {
      setProgress(null);
      toast.error(error instanceof Error ? error.message : apiErrorMessage(error));
    },
  });

  return { ...mutation, progress };
}

export function useDeleteFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/uploads/${id}`);
      return id;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assignments'] });
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      toast.success('File removed');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
}

/** Drag-and-drop handlers shared by the upload surfaces. */
export function useDropzone(onFile: (file: File) => void) {
  const [dragging, setDragging] = useState(false);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return { dragging, onDragOver, onDragLeave, onDrop };
}
