import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { noteService } from '@/server/services/note.service';
import { autosaveNoteSchema } from '@/server/validators/note.validator';

export const PUT = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const note = await noteService.updateNote(user.id, params.id, await readJson(req, autosaveNoteSchema), { automatic: true });
  return ok({ id: note.id, updatedAt: note.updatedAt, wordCount: note.wordCount });
});
