import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { noteService } from '@/server/services/note.service';
import { archiveSchema } from '@/server/validators/note.validator';

export const PATCH = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { archived } = await readJson(req, archiveSchema);
  return ok(await noteService.setArchived(user.id, params.id, archived));
});
