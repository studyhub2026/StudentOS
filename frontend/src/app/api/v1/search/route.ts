import { NextRequest } from 'next/server';
import { z } from 'zod';
import { route, readQuery } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok } from '@/server/lib/response';
import { universalSearch, type SearchCategory } from '@/server/services/search.service';

const VALID_CATEGORIES: SearchCategory[] = [
  'assignment', 'note', 'subject', 'flashcard_deck', 'flashcard',
  'schedule', 'ai_conversation', 'tutor_conversation', 'group',
  'group_message', 'uploaded_file', 'goal', 'notification',
];

const querySchema = z.object({
  q: z.string().min(1).max(200),
  categories: z
    .string()
    .optional()
    .transform((v) => (v ? (v.split(',') as SearchCategory[]) : undefined)),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const GET = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { q, categories, limit, offset } = readQuery(req, querySchema);

  const data = await universalSearch({
    query: q,
    userId: user.id,
    categories,
    limit,
    offset,
  });

  return ok(data);
});
