import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { flashcardService } from '@/server/services/flashcard.service';

export const GET = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const deck = await flashcardService.exportDeck(user.id, params.id);
  const format = req.nextUrl.searchParams.get('format') === 'csv' ? 'csv' : 'json';
  const safeName = deck.name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'deck';

  if (format === 'csv') {
    return new NextResponse(flashcardService.toCsv(deck), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeName}.csv"`,
      },
    });
  }
  return new NextResponse(JSON.stringify(deck, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${safeName}.json"`,
    },
  });
});
