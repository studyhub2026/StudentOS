export const maxDuration = 45;
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import {
  analyseMap,
  generateStudyGuide,
  summariseBranch,
  summariseMap,
} from '@/server/services/mind-map-ai.service';

/**
 * POST /api/v1/mind-maps/:id/actions
 *
 * One endpoint for all whole-map / branch text actions so the UI can add new
 * options without new routes. Returns { text } for every variant so the
 * client can render each one in the same panel.
 *
 * Actions:
 *   - summarise-map    : whole-map summary
 *   - study-guide      : whole-map study guide (sections)
 *   - analyse          : quality analysis (findings only, no auto-changes)
 *   - summarise-branch : summarise subtree rooted at { nodeId }
 */
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('summarise-map') }),
  z.object({ action: z.literal('study-guide') }),
  z.object({ action: z.literal('analyse') }),
  z.object({ action: z.literal('summarise-branch'), nodeId: z.string().min(1).max(60) }),
]);

export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const body = await readJson(req, bodySchema);
  const { id } = params;

  switch (body.action) {
    case 'summarise-map':
      return ok(await summariseMap(user.id, id));
    case 'study-guide':
      return ok(await generateStudyGuide(user.id, id));
    case 'analyse':
      return ok(await analyseMap(user.id, id));
    case 'summarise-branch':
      return ok(await summariseBranch(user.id, id, body.nodeId));
  }
});
