import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { noteService } from '@/server/services/note.service';
import { updateNoteSchema } from '@/server/validators/note.validator';

export const GET = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await noteService.getNote(user.id, params.id));
});

export const PATCH = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await noteService.updateNote(user.id, params.id, await readJson(req, updateNoteSchema)));
});

export const DELETE = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await noteService.deleteNote(user.id, params.id);
  return ok({ message: 'Note moved to trash' });
});
