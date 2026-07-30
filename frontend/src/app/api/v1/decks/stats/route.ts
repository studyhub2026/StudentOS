import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { readQuery, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { flashcardService } from '@/server/services/flashcard.service';
import { statsQuerySchema } from '@/server/validators/flashcard.validator';

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const q = readQuery(req, statsQuerySchema);
  return ok(await flashcardService.getStats(user.id, { deckId: q.deckId, heatmapDays: q.heatmapDays, forecastDays: q.forecastDays }));
});
