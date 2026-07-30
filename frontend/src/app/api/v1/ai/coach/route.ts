export const maxDuration = 60;
import type { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { aiService } from '@/server/services/ai.service';
import { coachSchema } from '@/server/validators/ai.validator';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const input = await readJson(req, coachSchema);

  let stats: { streak: number; studyMinutesWeek: number; overdue: number } | undefined;
  if (input.includeStats) {
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - 6);
    const [record, sessions, overdue] = await Promise.all([
      prisma.user.findUnique({ where: { id: user.id }, select: { currentStreak: true } }),
      prisma.studySession.aggregate({ where: { userId: user.id, startedAt: { gte: weekStart } }, _sum: { durationSeconds: true } }),
      prisma.assignment.count({ where: { userId: user.id, deletedAt: null, dueAt: { lt: new Date() }, status: { notIn: ['COMPLETED', 'SUBMITTED', 'ARCHIVED'] } } }),
    ]);
    stats = {
      streak: record?.currentStreak ?? 0,
      studyMinutesWeek: Math.round((sessions._sum.durationSeconds ?? 0) / 60),
      overdue,
    };
  }

  return ok(await aiService.coach({ situation: input.situation, ...(stats ? { stats } : {}) }));
});
