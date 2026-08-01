import 'server-only';
import { prisma } from '@/server/db';
import { NotFoundError } from '@/server/lib/errors';
import { generateText, generateFromPrompt, type GeminiInlinePart } from './gemini.service';

const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 200;

function chunkText(text: string): { content: string; index: number }[] {
  const chunks: { content: string; index: number }[] = [];
  let i = 0;
  let idx = 0;
  while (i < text.length) {
    const end = Math.min(i + CHUNK_SIZE, text.length);
    chunks.push({ content: text.slice(i, end), index: idx });
    i += CHUNK_SIZE - CHUNK_OVERLAP;
    idx++;
  }
  return chunks;
}

export async function createCollection(
  userId: string,
  input: { name: string; description?: string; color?: string; icon?: string },
) {
  return prisma.knowledgeCollection.create({
    data: { userId, name: input.name, description: input.description, color: input.color, icon: input.icon },
  });
}

export async function listCollections(userId: string) {
  return prisma.knowledgeCollection.findMany({
    where: { userId },
    include: { _count: { select: { documents: true } } },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function updateCollection(
  userId: string,
  id: string,
  input: { name?: string; description?: string; color?: string; icon?: string },
) {
  return prisma.knowledgeCollection.update({
    where: { id, userId },
    data: input,
  });
}

export async function deleteCollection(userId: string, id: string) {
  return prisma.knowledgeCollection.delete({ where: { id, userId } });
}

export async function addDocument(
  userId: string,
  input: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    storageUrl: string;
    storageKey: string;
    collectionId?: string;
    tags?: string[];
    extractedText?: string;
  },
) {
  const doc = await prisma.knowledgeDocument.create({
    data: {
      userId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageUrl: input.storageUrl,
      storageKey: input.storageKey,
      collectionId: input.collectionId,
      tags: input.tags ?? [],
      extractedText: input.extractedText,
    },
  });

  if (input.extractedText) {
    const chunks = chunkText(input.extractedText);
    await prisma.knowledgeChunk.createMany({
      data: chunks.map((c) => ({
        documentId: doc.id,
        chunkIndex: c.index,
        content: c.content,
      })),
    });
    // Return the updated row so the response carries the real chunkCount rather
    // than the stale 0 from the initial create.
    return prisma.knowledgeDocument.update({
      where: { id: doc.id },
      data: { chunkCount: chunks.length },
    });
  }

  return doc;
}

export async function listDocuments(userId: string, collectionId?: string) {
  return prisma.knowledgeDocument.findMany({
    where: { userId, ...(collectionId ? { collectionId } : {}) },
    include: { collection: { select: { id: true, name: true, color: true } } },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function deleteDocument(userId: string, id: string) {
  return prisma.knowledgeDocument.delete({ where: { id, userId } });
}

export async function searchKnowledge(userId: string, query: string, limit = 10) {
  const chunks = await prisma.knowledgeChunk.findMany({
    where: {
      document: { userId },
      content: { contains: query, mode: 'insensitive' },
    },
    include: {
      document: { select: { id: true, filename: true, mimeType: true, collectionId: true } },
    },
    take: limit,
    orderBy: { chunkIndex: 'asc' },
  });

  return chunks.map((c) => ({
    chunkId: c.id,
    documentId: c.document.id,
    filename: c.document.filename,
    content: c.content,
    chunkIndex: c.chunkIndex,
    pageNumber: c.pageNumber,
    heading: c.heading,
  }));
}

export async function askKnowledge(
  userId: string,
  question: string,
  opts?: { collectionId?: string; documentIds?: string[]; citeSources?: boolean },
) {
  const whereDoc: Record<string, unknown> = { userId };
  if (opts?.collectionId) whereDoc.collectionId = opts.collectionId;
  if (opts?.documentIds?.length) whereDoc.id = { in: opts.documentIds };

  const relevantChunks = await prisma.knowledgeChunk.findMany({
    where: {
      document: whereDoc,
      content: { contains: question.split(' ').slice(0, 3).join(' '), mode: 'insensitive' },
    },
    include: {
      document: { select: { id: true, filename: true } },
    },
    take: 15,
    orderBy: { chunkIndex: 'asc' },
  });

  if (relevantChunks.length === 0) {
    const allDocs = await prisma.knowledgeDocument.findMany({
      where: whereDoc,
      select: { extractedText: true, filename: true },
      take: 5,
    });
    const context = allDocs
      .filter((d) => d.extractedText)
      .map((d) => `## ${d.filename}\n${d.extractedText!.slice(0, 3000)}`)
      .join('\n\n');

    if (!context) {
      return { answer: 'No relevant knowledge found. Upload documents first.', sources: [] };
    }

    const result = await generateFromPrompt(
      `Based on the following documents, answer: ${question}\n\n${context}`,
      {
        systemInstruction:
          'You are a knowledge assistant. Answer using ONLY the provided documents. Cite the source document name. Use Markdown.',
        maxOutputTokens: 4096,
      },
    );
    return { answer: result.text, sources: allDocs.map((d) => d.filename) };
  }

  const context = relevantChunks
    .map((c) => `[${c.document.filename}, chunk ${c.chunkIndex + 1}]\n${c.content}`)
    .join('\n\n---\n\n');

  const result = await generateFromPrompt(
    `Based on the following knowledge base excerpts, answer: ${question}\n\n${context}`,
    {
      systemInstruction:
        'You are a knowledge assistant. Answer using ONLY the provided knowledge base excerpts. Always cite which document the information came from. Use Markdown formatting.',
      maxOutputTokens: 4096,
    },
  );

  const sources = [...new Set(relevantChunks.map((c) => c.document.filename))];
  return { answer: result.text, sources };
}
