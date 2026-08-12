import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import * as examService from '@/server/services/exam.service';

export const GET = route<{ attemptId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { attemptId } = params;
  return ok(await examService.getExamAttempt(user.id, attemptId));
});

const submitSchema = z.object({
  answers: z.record(z.coerce.number(), z.string()),
});

export const PATCH = route<{ attemptId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { attemptId } = params;
  const { answers } = await readJson(req, submitSchema);
  return ok(await examService.submitExam(user.id, attemptId, answers));
});
