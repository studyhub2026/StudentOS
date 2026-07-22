'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Pause,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { AiGenerateDialog } from '@/components/flashcards/ai-generate-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  useCards,
  useCreateCard,
  useDeck,
  useDeleteCard,
  useUpdateCard,
} from '@/hooks/use-flashcards';
import { cn } from '@/lib/utils';
import type { CardDifficulty } from '@/types/api';

const DIFFICULTIES: CardDifficulty[] = ['EASY', 'MEDIUM', 'HARD'];

const DIFFICULTY_TONE = {
  EASY: 'success',
  MEDIUM: 'info',
  HARD: 'warning',
} as const;

export default function DeckDetailPage() {
  const params = useParams<{ deckId: string }>();
  const deckId = params.deckId;

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [difficulty, setDifficulty] = useState<CardDifficulty[]>([]);
  const [adding, setAdding] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');

  const search = useDebouncedValue(searchInput, 300);

  const filters = useMemo(
    () => ({
      page,
      limit: 25,
      ...(search ? { search } : {}),
      ...(difficulty.length ? { difficulty } : {}),
    }),
    [page, search, difficulty],
  );

  const { data: deck } = useDeck(deckId);
  const { data, isLoading, isPlaceholderData } = useCards(deckId, filters);

  const createCard = useCreateCard();
  const updateCard = useUpdateCard();
  const deleteCard = useDeleteCard();

  function toggleDifficulty(value: CardDifficulty) {
    setDifficulty((current) =>
      current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value],
    );
    setPage(1);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link
        href="/flashcards"
        className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All decks
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {deck?.name ?? 'Deck'}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {deck
              ? `${deck.totalCards} cards · ${deck.dueCards} due · ${deck.matureCards} mature`
              : 'Loading…'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setAiOpen(true)}>
            <Sparkles className="h-4 w-4" aria-hidden />
            Generate with AI
          </Button>
          <Button size="sm" onClick={() => setAdding((open) => !open)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add card
          </Button>
          {deck && deck.dueCards > 0 ? (
            <Link href={`/flashcards/review?deckId=${deckId}`}>
              <Button size="sm">
                <Play className="h-4 w-4" aria-hidden />
                Review
              </Button>
            </Link>
          ) : null}
        </div>
      </header>

      {adding ? (
        <Card>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!front.trim() || !back.trim()) return;
              createCard.mutate(
                { deckId, body: { front: front.trim(), back: back.trim() } },
                {
                  onSuccess: () => {
                    setFront('');
                    setBack('');
                  },
                },
              );
            }}
          >
            <Input
              label="Front"
              value={front}
              onChange={(event) => setFront(event.target.value)}
              placeholder="What does mitochondria do?"
              autoFocus
            />
            <Input
              label="Back"
              value={back}
              onChange={(event) => setBack(event.target.value)}
              placeholder="Generates ATP through cellular respiration."
            />
            <div className="flex gap-2">
              <Button type="submit" loading={createCard.isPending}>
                Add card
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                Done
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setPage(1);
            }}
            placeholder="Search cards…"
            aria-label="Search cards"
            className="h-10 w-full rounded-xl border border-border bg-surface-raised pl-9 pr-3 text-sm placeholder:text-fg-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
        </div>

        <div className="flex gap-1.5">
          {DIFFICULTIES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={difficulty.includes(value)}
              onClick={() => toggleDifficulty(value)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs transition-colors',
                difficulty.includes(value)
                  ? 'border-brand bg-brand/15 text-brand-bright'
                  : 'border-border text-fg-muted hover:border-border-strong',
              )}
            >
              {value.charAt(0) + value.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="font-medium">{search ? 'No cards match' : 'No cards yet'}</p>
          <p className="mt-1 text-sm text-fg-muted">
            {search ? 'Try a different search.' : 'Add cards by hand or generate them with AI.'}
          </p>
        </Card>
      ) : (
        <ul className={cn('space-y-2 transition-opacity', isPlaceholderData && 'opacity-60')}>
          {data.items.map((card) => (
            <li
              key={card.id}
              className={cn(
                'group rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong',
                card.suspended && 'opacity-50',
              )}
            >
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{card.front}</p>
                  <p className="mt-1 text-sm text-fg-muted">{card.back}</p>
                  {card.hint ? (
                    <p className="mt-1 text-xs italic text-fg-subtle">Hint: {card.hint}</p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                    <Badge tone={DIFFICULTY_TONE[card.difficulty]}>
                      {card.difficulty.charAt(0) + card.difficulty.slice(1).toLowerCase()}
                    </Badge>
                    <span>{card.state.toLowerCase()}</span>
                    {card.repetitions > 0 ? <span>{card.repetitions} reps</span> : null}
                    {card.lapses > 0 ? <span>{card.lapses} lapses</span> : null}
                    {card.generatedByAi ? (
                      <span className="flex items-center gap-1 text-brand-bright">
                        <Sparkles className="h-3 w-3" aria-hidden />
                        AI
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={card.suspended ? 'Unsuspend card' : 'Suspend card'}
                    onClick={() =>
                      updateCard.mutate({
                        cardId: card.id,
                        body: { suspended: !card.suspended },
                      })
                    }
                  >
                    {card.suspended ? (
                      <EyeOff className="h-4 w-4" aria-hidden />
                    ) : (
                      <Pause className="h-4 w-4" aria-hidden />
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete card"
                    className="text-fg-subtle hover:text-danger"
                    onClick={() => deleteCard.mutate(card.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && data.pagination.totalPages > 1 ? (
        <nav className="flex items-center justify-between" aria-label="Pagination">
          <p className="text-sm text-fg-subtle">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!data.pagination.hasPrevious}
              onClick={() => setPage((current) => current - 1)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!data.pagination.hasNext}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </nav>
      ) : null}

      {aiOpen ? <AiGenerateDialog deckId={deckId} onClose={() => setAiOpen(false)} /> : null}
    </div>
  );
}
