import { NextRequest } from 'next/server';
import { z } from 'zod';
import { route, readJson, readQuery } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok, created } from '@/server/lib/response';
import { listDocuments, addDocument } from '@/server/services/knowledge.service';

const listSchema = z.object({
  collectionId: z.string().optional(),
});

const createSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  storageUrl: z.string().url(),
  storageKey: z.string().min(1),
  collectionId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  extractedText: z.string().optional(),
});

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { collectionId } = readQuery(req, listSchema);
  const docs = await listDocuments(user.id, collectionId);
  return ok(docs);
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const body = await readJson(req, createSchema);
  const doc = await addDocument(user.id, body);
  return created(doc);
});
