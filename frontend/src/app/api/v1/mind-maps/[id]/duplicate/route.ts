import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { created } from '@/server/lib/response';
import * as mindMap from '@/server/services/mind-map.service';

export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  return created(await mindMap.duplicateMindMap(user.id, params.id));
});
