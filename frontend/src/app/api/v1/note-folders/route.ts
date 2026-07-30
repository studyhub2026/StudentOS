import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created, ok } from '@/server/lib/response';
import { noteService } from '@/server/services/note.service';
import { createFolderSchema } from '@/server/validators/note.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return ok(await noteService.listFolders(user.id));
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return created(await noteService.createFolder(user.id, await readJson(req, createFolderSchema)));
});
