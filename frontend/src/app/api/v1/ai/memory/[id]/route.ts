import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { aiMemoryService } from '@/server/services/ai-memory.service';

export const DELETE = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  await aiMemoryService.deleteMemory(user.id, params.id);
  return ok({ message: 'Memory removed' });
});
