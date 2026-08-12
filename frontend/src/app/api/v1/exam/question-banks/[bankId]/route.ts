import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import * as examService from '@/server/services/exam.service';

export const GET = route<{ bankId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { bankId } = params;
  return ok(await examService.getQuestionBankById(user.id, bankId));
});

export const DELETE = route<{ bankId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { bankId } = params;
  await examService.deleteQuestionBank(user.id, bankId);
  return ok({ deleted: true });
});
