import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { noteService } from '@/server/services/note.service';
import { favoriteSchema } from '@/server/validators/note.validator';

export const PATCH = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { favorite } = await readJson(req, favoriteSchema);
  return ok(await noteService.setFavorite(user.id, params.id, favorite));
});
