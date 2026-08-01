import { NextRequest } from 'next/server';
import { route } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok } from '@/server/lib/response';
import { deleteDocument } from '@/server/services/knowledge.service';

export const DELETE = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await deleteDocument(user.id, params.id);
  return ok({ deleted: true });
});
