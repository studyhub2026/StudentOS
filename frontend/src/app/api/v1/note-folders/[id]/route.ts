import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { noteService } from '@/server/services/note.service';
import { updateFolderSchema } from '@/server/validators/note.validator';

export const PATCH = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await noteService.updateFolder(user.id, params.id, await readJson(req, updateFolderSchema)));
});

export const DELETE = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await noteService.deleteFolder(user.id, params.id);
  return ok({ message: 'Folder deleted' });
});
