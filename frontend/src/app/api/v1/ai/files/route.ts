export const maxDuration = 60;
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, readQuery, route } from '@/server/lib/handler';
import { created, ok } from '@/server/lib/response';
import { aiFileService } from '@/server/services/ai-file.service';
import { listAiFilesSchema, registerAiFileSchema } from '@/server/validators/ai.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { conversationId } = readQuery(req, listAiFilesSchema);
  return ok(await aiFileService.listConversationFiles(user.id, conversationId));
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const body = await readJson(req, registerAiFileSchema);
  const file = await aiFileService.registerAndProcess(user.id, {
    conversationId: body.conversationId,
    filename: body.filename,
    mimeType: body.mimeType,
    size: body.size,
    storageUrl: body.url,
    ...(body.storageKey ? { storageKey: body.storageKey } : {}),
  });
  return created(file);
});
