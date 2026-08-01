'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';
import { AI_FILE_ACCEPT, guessMime, validateAiFile } from './use-ai-files';

export { AI_FILE_ACCEPT as KNOWLEDGE_FILE_ACCEPT };

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
): Promise<{ public_id: string; secure_url: string; bytes: number }> {
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', signed.apiKey);
  form.append('timestamp', String(signed.timestamp));
  form.append('public_id', signed.publicId);
  form.append('signature', signed.signature);
  return fetch(signed.uploadUrl, { method: 'POST', body: form }).then(async (res) => {
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    return res.json();
  });
}

/**
 * Signs, uploads the file to Cloudinary, then registers it as a knowledge
 * document — the server fetches the persisted bytes and extracts/OCRs the text.
 */
export async function uploadKnowledgeFile(
  file: File,
  collectionId?: string,
): Promise<void> {
  const invalid = validateAiFile(file);
  if (invalid) throw new Error(invalid);

  const { data: signResponse } = await apiClient.post<ApiEnvelope<SignedUpload>>('/uploads/sign', {
    folder: 'ai',
  });
  const uploaded = await uploadToCloudinary(signResponse.data, file);

  await apiClient.post('/knowledge', {
    filename: file.name,
    mimeType: guessMime(file),
    sizeBytes: uploaded.bytes || file.size,
    url: uploaded.secure_url,
    storageKey: uploaded.public_id,
    collectionId,
  });
}

interface KnowledgeCollection {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
  _count: { documents: number };
}

interface KnowledgeDocument {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageUrl: string;
  tags: string[];
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  collection: { id: string; name: string; color: string } | null;
}

interface SearchChunk {
  chunkId: string;
  documentId: string;
  filename: string;
  content: string;
  chunkIndex: number;
  pageNumber: number | null;
  heading: string | null;
}

interface AskResult {
  answer: string;
  sources: string[];
}

export function useKnowledgeCollections() {
  return useQuery({
    queryKey: ['knowledge-collections'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<KnowledgeCollection[]>>('/knowledge/collections');
      return data.data;
    },
  });
}

export function useKnowledgeDocuments(collectionId?: string) {
  return useQuery({
    queryKey: ['knowledge-documents', collectionId],
    queryFn: async () => {
      const params = collectionId ? `?collectionId=${collectionId}` : '';
      const { data } = await apiClient.get<ApiEnvelope<KnowledgeDocument[]>>(`/knowledge${params}`);
      return data.data;
    },
  });
}

export function useCreateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string; color?: string }) => {
      const { data } = await apiClient.post<ApiEnvelope<KnowledgeCollection>>('/knowledge/collections', input);
      return data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-collections'] }),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/knowledge/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-documents'] }),
  });
}

export function useSearchKnowledge(query: string) {
  return useQuery({
    queryKey: ['knowledge-search', query],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<SearchChunk[]>>(`/knowledge/search?q=${encodeURIComponent(query)}`);
      return data.data;
    },
    enabled: query.trim().length >= 2,
    staleTime: 30_000,
  });
}

export function useAskKnowledge() {
  return useMutation({
    mutationFn: async (input: { question: string; collectionId?: string; documentIds?: string[] }) => {
      const { data } = await apiClient.post<ApiEnvelope<AskResult>>('/knowledge/ask', input);
      return data.data;
    },
  });
}
