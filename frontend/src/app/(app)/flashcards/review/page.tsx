'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Keyboard, Loader2, PartyPopper, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { deckKeys, useReviewCard, useReviewQueue } from '@/hooks/use-flashcards';
import { cn } from '@/lib/utils';
import { useReviewStore } from '@/stores/review-store';
import type { ReviewRating } from '@/types/api';

const RATINGS: { key: ReviewRating; label: string; shortcut: string; tone: string }[] = [
  { key: 'again', label: 'Again', shortcut: '1', tone: 'border-danger/40 bg-danger/12 text-danger hover:bg-danger/20' },
  { key: 'hard', label: 'Hard', shortcut: '2', tone: 'border-warning/40 bg-warning/12 text-warning hover:bg-warning/20' },
  { key: 'good', label: 'Good', shortcut: '3', tone: 'border-accent/40 bg-accent/12 text-accent hover:bg-accent/20' },
  { key: 'easy', label: 'Easy', shortcut: '4', tone: 'border-success/40 bg-success/12 text-success hover:bg-success/20' },
];

function formatInterval(days: number): string {
  if (days < 1) return '<1d';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

function ReviewSession() {
  const searchParams = useSearchParams();
  const deckId = searchParams.get('deckId') ?? undefined;

  const queryClient = useQueryClient();
  const { data: queue, isLoading, isError } = useReviewQueue(deckId);
  const reviewCard = useReviewCard();

  const store = useReviewStore();
  const card = store.currentCard();

  // Load the queue into the session store exactly once per fetch.
  useEffect(() => {
    if (queue) store.start(queue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  // Clear session state when leaving, so a later visit starts fresh.
  useEffect(() => () => store.reset(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const grade = useCallback(
    (rating: ReviewRating) => {
      const current = useReviewStore.getState().currentCard();
      if (!current) return;

      const elapsed = useReviewStore.getState().elapsedMs();

      // Advance immediately; the grade is persisted in the background so the
      // session never waits on the network between cards.
      useReviewStore.getState().grade(rating);
      reviewCard.mutate({ cardId: current.id, rating, responseMs: elapsed });
    },
    [reviewCard],
  );

  // Refresh deck counts and stats once the session ends.
  useEffect(() => {
    if (store.finished && store.answered > 0) {
      void queryClient.invalidateQueries({ queryKey: deckKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: deckKeys.stats(deckId) });
    }
  }, [store.finished, store.answered, queryClient, deckId]);

  // Keyboard shortcuts: space reveals, 1–4 grade.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      const state = useReviewStore.getState();
      if (!state.currentCard()) return;

      if (event.code === 'Space' || event.key === 'Enter') {
        event.preventDefault();
        if (!state.revealed) state.reveal();
        return;
      }

      if (!state.revealed) return;

      const rating = RATINGS.find((entry) => entry.shortcut === event.key);
      if (rating) {
        event.preventDefault();
        grade(rating.key);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [grade]);

  if (isLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand" aria-label="Loading queue" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <p className="font-medium">Could not load your review queue</p>
        <Link href="/flashcards">
          <Button className="mt-4" variant="secondary">
            Back to decks
          </Button>
        </Link>
      </Card>
    );
  }

  if (!card) {
    const reviewed = store.answered;

    return (
      <Card className="mx-auto max-w-md text-center">
        {reviewed > 0 ? (
          <>
            <PartyPopper className="mx-auto h-10 w-10 text-brand-bright" aria-hidden />
            <h1 className="mt-3 text-xl font-semibold">Session complete</h1>
            <p className="mt-1 text-sm text-fg-muted">
              {reviewed} card{reviewed === 1 ? '' : 's'} reviewed · {store.accuracy()}% recalled
              first time
            </p>
          </>
        ) : (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10 text-success" aria-hidden />
            <h1 className="mt-3 text-xl font-semibold">Nothing due</h1>
            <p className="mt-1 text-sm text-fg-muted">
              You are up to date. Come back when cards are scheduled.
            </p>
          </>
        )}

        <Link href="/flashcards">
          <Button className="mt-5">Back to decks</Button>
        </Link>
      </Card>
    );
  }

  const total = store.queue.length;
  const progress = total === 0 ? 0 : Math.round((store.index / total) * 100);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-2xl flex-col">
      <header className="mb-5 flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand to-accent transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-fg-subtle">
            {store.remaining()} remaining · {store.answered} done
            {store.answered > 0 ? ` · ${store.accuracy()}% recall` : ''}
          </p>
        </div>

        <Link href="/flashcards">
          <Button variant="ghost" size="icon" aria-label="End session">
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </Link>
      </header>

      <Card className="flex flex-1 flex-col justify-center p-8 text-center">
        <div className="mb-2 flex justify-center gap-2 text-xs text-fg-subtle">
          <span className="rounded-full bg-surface-raised px-2 py-0.5">
            {card.state === 'NEW' ? 'New card' : `Interval ${formatInterval(card.intervalDays)}`}
          </span>
          {card.lapses > 0 ? (
            <span className="rounded-full bg-surface-raised px-2 py-0.5">
              {card.lapses} lapse{card.lapses === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>

        <p className="text-xl font-medium leading-relaxed whitespace-pre-wrap">{card.front}</p>

        {store.revealed ? (
          <>
            <hr className="my-6 border-border" />
            <p className="text-lg leading-relaxed text-fg-muted whitespace-pre-wrap">
              {card.back}
            </p>
          </>
        ) : card.hint ? (
          <p className="mt-4 text-sm italic text-fg-subtle">Hint: {card.hint}</p>
        ) : null}
      </Card>

      <div className="mt-5">
        {!store.revealed ? (
          <Button size="lg" className="w-full" onClick={store.reveal}>
            Show answer
            <kbd className="ml-1 rounded border border-white/25 px-1.5 py-0.5 text-xs">Space</kbd>
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RATINGS.map((rating) => (
              <button
                key={rating.key}
                type="button"
                onClick={() => grade(rating.key)}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-xl border px-3 py-3 text-sm font-medium transition-colors active:scale-[0.98]',
                  rating.tone,
                )}
              >
                <span>{rating.label}</span>
                <span className="text-xs opacity-70">
                  {formatInterval(card.intervalPreview[rating.key])}
                </span>
                <kbd className="mt-0.5 rounded border border-current/25 px-1 text-[10px] opacity-60">
                  {rating.shortcut}
                </kbd>
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-fg-subtle">
        <Keyboard className="h-3.5 w-3.5" aria-hidden />
        Space to reveal · 1–4 to grade
      </p>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-[60vh] place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-brand" aria-label="Loading" />
        </div>
      }
    >
      <ReviewSession />
    </Suspense>
  );
}
