import type { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { noteService } from '@/server/services/note.service';
import { aiStudyService } from '@/server/services/ai-study.service';

export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const note = await noteService.getNote(user.id, params.id);
  const result = await aiStudyService.summariseNote(note.content);
  await prisma.note.update({ where: { id: params.id }, data: { aiSummary: result.summary, aiSummaryAt: new Date() } });
  return ok({ summary: result.summary, keyPoints: result.keyPoints, model: result.model, totalTokens: result.totalTokens });
});
