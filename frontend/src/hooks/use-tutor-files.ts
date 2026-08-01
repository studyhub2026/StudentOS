'use client';

import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';
import { AI_FILE_ACCEPT, guessMime, validateAiFile } from '@/hooks/use-ai-files';

/**
 * File uploads for tutor conversations. Reuses the AI-chat validation and the
 * Cloudinary sign flow; only the register endpoint differs (it scopes the file
 * to a tutor conversation).
 */

export { AI_FILE_ACCEPT, validateAiFile };

export interface TutorUploadedFile {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  storageUrl: string;
  kind: 'DOCUMENT' | 'IMAGE';
  status: 'PENDING' | 'READY' | 'FAILED';
  createdAt: string;
}

interface SignedUpload {
  signature: string;
  timestamp: number;
  apiKey: string;
  publicId: string;
  uploadUrl: string;
}

function uploadToCloudinary(
  signed: SignedUpload,
  file: File,
  onProgress: (percent: number) => void,
): Promise<{ public_id: string; secure_url: string; bytes: number }> {
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
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Storage returned a malformed response'));
        }
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));
    xhr.send(form);
  });
}

export async function uploadTutorFile(
  tutorId: string,
  conversationId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<TutorUploadedFile> {
  const invalid = validateAiFile(file);
  if (invalid) throw new Error(invalid);

  // Reuses the shared "ai" upload policy (25 MB, same document/image formats).
  const { data: signResponse } = await apiClient.post<ApiEnvelope<SignedUpload>>('/uploads/sign', {
    folder: 'ai',
  });
  const uploaded = await uploadToCloudinary(signResponse.data, file, onProgress);

  const { data: registered } = await apiClient.post<ApiEnvelope<TutorUploadedFile>>(
    `/ai/tutors/${tutorId}/files`,
    {
      conversationId,
      filename: file.name,
      mimeType: guessMime(file),
      size: uploaded.bytes || file.size,
      url: uploaded.secure_url,
      storageKey: uploaded.public_id,
    },
  );
  return registered.data;
}

export async function deleteTutorFile(tutorId: string, id: string): Promise<void> {
  await apiClient.delete(`/ai/tutors/${tutorId}/files/${id}`);
}
