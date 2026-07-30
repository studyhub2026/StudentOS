import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, readQuery, route } from '@/server/lib/handler';
import { created, paginated } from '@/server/lib/response';
import { noteService } from '@/server/services/note.service';
import { createNoteSchema, listNotesSchema } from '@/server/validators/note.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const result = await noteService.listNotes(user.id, readQuery(req, listNotesSchema));
  return paginated(result.items, result.pagination);
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return created(await noteService.createNote(user.id, await readJson(req, createNoteSchema)));
});
