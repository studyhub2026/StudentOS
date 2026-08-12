import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/lib/auth';
import { readJson, readQuery, route } from '@/server/lib/handler';
import { ok, created } from '@/server/lib/response';
import * as examService from '@/server/services/exam.service';

const querySchema = z.object({
  subjectId: z.string().optional(),
});

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { subjectId } = readQuery(req, querySchema);
  return ok(await examService.getQuestionBanks(user.id, subjectId));
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  subjectId: z.string().optional(),
  questions: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const body = await readJson(req, createSchema);
  return created(await examService.saveQuestionBank(user.id, body));
});
