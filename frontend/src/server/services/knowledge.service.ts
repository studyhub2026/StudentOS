import 'server-only';
import { prisma } from '@/server/db';
import { BadRequestError, NotFoundError } from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { generateFromPrompt } from './gemini.service';
import { MAX_UPLOAD_BYTES, extractText, resolveType } from './file-extract.service';

const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 200;

/**
 * Pulls prompt-ready text out of an uploaded document. Office and text formats
 * are extracted locally; PDFs and images are handed to Gemini for OCR/reading
 * so scanned material still becomes searchable knowledge. Best-effort: a failed
 * extraction leaves the document stored with no chunks rather than rejecting it.
 */
async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<string | null> {
  const spec = resolveType(mimeType, filename);

  if (spec.mode !== 'gemini') {
    return extractText(buffer, mimeType, filename);
  }

  // PDF / image → let Gemini transcribe the content (native reader + OCR).
  try {
    const result = await generateFromPrompt(
      'Extract all readable text from this document verbatim, preserving headings and order. ' +
        'Include text from tables and diagrams. Return only the extracted text, no commentary.',
      {
        attachments: [{ mimeType, dataBase64: buffer.toString('base64') }],
        maxOutputTokens: 8192,
      },
    );
    return result.text.trim() || null;
  } catch (error) {
    logger.warn({ err: error, filename }, 'knowledge: Gemini extraction failed');
    return null;
  }
}

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
  },
) {
  if (input.sizeBytes > MAX_UPLOAD_BYTES) {
    throw new BadRequestError('That file is larger than the 25 MB limit.');
  }
  // Authoritative MIME/type check — throws for anything off the allowlist.
  resolveType(input.mimeType, input.filename);

  // Only accept files that actually live in the configured object storage, so a
  // blob: URL or an attacker-supplied URL can never be persisted or refetched.
  if (!/^https:\/\/res\.cloudinary\.com\//.test(input.storageUrl)) {
    throw new BadRequestError('Upload URL is not from the configured storage.');
  }

  if (input.collectionId) {
    const owned = await prisma.knowledgeCollection.findFirst({
      where: { id: input.collectionId, userId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundError('Collection');
  }

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
    },
  });

  // Fetch the persisted bytes and extract text server-side. Best-effort: if the
  // fetch or extraction fails the document is still stored (searchable by name),
  // just without chunks.
  let extractedText: string | null = null;
  try {
    const response = await fetch(input.storageUrl);
    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength <= MAX_UPLOAD_BYTES) {
        extractedText = await extractDocumentText(buffer, input.mimeType, input.filename);
      }
    }
  } catch (error) {
    logger.warn({ err: error, filename: input.filename }, 'knowledge: could not fetch upload');
  }

  if (!extractedText) return doc;

  const chunks = chunkText(extractedText);
  await prisma.knowledgeChunk.createMany({
    data: chunks.map((c) => ({
      documentId: doc.id,
      chunkIndex: c.index,
      content: c.content,
    })),
  });
  // Return the updated row so the response carries the real chunkCount and text.
  return prisma.knowledgeDocument.update({
    where: { id: doc.id },
    data: { chunkCount: chunks.length, extractedText },
  });
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
