import type { NextRequest } from 'next/server';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { noteService } from '@/server/services/note.service';

// Public: resolves a share link without authentication.
export const GET = route<{ token: string }>(async (_req: NextRequest, { params }) => {
  return ok(await noteService.getSharedNote(params.token));
});
