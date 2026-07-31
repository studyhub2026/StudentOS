'use client';

import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

export const MAX_AI_FILE_BYTES = 25 * 1024 * 1024;

/** Extension → canonical MIME, so files the browser leaves untyped still resolve. */
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** The `accept` attribute for the file picker. */
export const AI_FILE_ACCEPT = Object.keys(EXT_MIME)
  .map((ext) => `.${ext}`)
  .join(',');

export interface AiUploadedFile {
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

function extensionOf(name: string): string {
  return name.toLowerCase().split('.').pop() ?? '';
}

export function guessMime(file: File): string {
  return file.type || EXT_MIME[extensionOf(file.name)] || 'application/octet-stream';
}

/** Client-side guard for a fast, clear message; the server re-checks everything. */
export function validateAiFile(file: File): string | null {
  if (file.size > MAX_AI_FILE_BYTES) {
    return `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 25 MB.`;
  }
  if (!(extensionOf(file.name) in EXT_MIME)) {
    return `"${file.name}" isn't a supported type. Use PDF, DOCX, PPTX, XLSX, CSV, TXT, MD or an image.`;
  }
  return null;
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

/**
 * Signs, uploads the file straight to storage (reporting progress), then
 * registers it against the conversation — where the server extracts its text.
 */
export async function uploadAiFile(
  conversationId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<AiUploadedFile> {
  const invalid = validateAiFile(file);
  if (invalid) throw new Error(invalid);

  const { data: signResponse } = await apiClient.post<ApiEnvelope<SignedUpload>>('/uploads/sign', {
    folder: 'ai',
  });
  const uploaded = await uploadToCloudinary(signResponse.data, file, onProgress);

  const { data: registered } = await apiClient.post<ApiEnvelope<AiUploadedFile>>('/ai/files', {
    conversationId,
    filename: file.name,
    mimeType: guessMime(file),
    size: uploaded.bytes || file.size,
    url: uploaded.secure_url,
    storageKey: uploaded.public_id,
  });
  return registered.data;
}

export async function deleteAiFile(id: string): Promise<void> {
  await apiClient.delete(`/ai/files/${id}`);
}
