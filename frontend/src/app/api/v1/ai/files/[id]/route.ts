import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { aiFileService } from '@/server/services/ai-file.service';

export const DELETE = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await aiFileService.deleteFile(user.id, params.id);
  return ok({ message: 'File removed' });
});
