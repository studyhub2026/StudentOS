import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created, ok } from '@/server/lib/response';
import { noteService } from '@/server/services/note.service';
import { shareNoteSchema } from '@/server/validators/note.validator';

export const GET = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return ok(await noteService.listShares(user.id, params.id));
});

export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return created(await noteService.shareNote(user.id, params.id, await readJson(req, shareNoteSchema)));
});
