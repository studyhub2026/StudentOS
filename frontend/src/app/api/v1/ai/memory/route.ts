import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { aiMemoryService } from '@/server/services/ai-memory.service';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  return ok(await aiMemoryService.listMemories(user.id));
});

export const DELETE = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const cleared = await aiMemoryService.clearMemories(user.id);
  return ok({ cleared });
});
