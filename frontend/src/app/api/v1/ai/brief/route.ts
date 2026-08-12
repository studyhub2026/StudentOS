/**
 * Fast path — returns whatever brief we have on hand and kicks off
 * regeneration in the background if today's is missing. Never blocks on
 * Gemini, so the dashboard load isn't held up by AI. The client polls
 * for the fresh brief via React Query (see hooks/use-ai-brief.ts).
 */
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { aiBriefService } from '@/server/services/ai-brief.service';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const existing = await aiBriefService.getExistingBrief(user.id);
  // Fire and forget — the client's next poll (30 s) picks up the new brief.
  aiBriefService.ensureTodayBriefAsync(user.id);
  return ok(existing);
});
