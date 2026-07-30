import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { noteService } from '@/server/services/note.service';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return ok(await noteService.listNotesSharedWithMe(user.id));
});
