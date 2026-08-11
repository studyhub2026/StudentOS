import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { groupService } from '@/server/services/group.service';

const voteSchema = z.object({
  optionIndex: z.number().int().min(0),
});

export const POST = route<{ id: string; pollId: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const { optionIndex } = await readJson(req, voteSchema);
  return ok(await groupService.votePoll(user.id, params.id, params.pollId, optionIndex));
});
