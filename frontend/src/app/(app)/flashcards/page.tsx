'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  Download,
  Layers,
  Play,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { HeatmapGrid } from '@/components/flashcards/heatmap-grid';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCreateDeck,
  useDecks,
  useDeleteDeck,
  useFlashcardStats,
  useImportDeck,
} from '@/hooks/use-flashcards';
import { apiErrorMessage } from '@/lib/api-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function FlashcardsPage() {
  const { data: decks, isLoading, isError, error } = useDecks();
  const { data: stats } = useFlashcardStats();

  const createDeck = useCreateDeck();
  const deleteDeck = useDeleteDeck();
  const importDeck = useImportDeck();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalDue = decks?.reduce((sum, deck) => sum + deck.dueCards, 0) ?? 0;

  async function handleImport(file: File) {
    const text = await file.text();
    const format = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json';
    importDeck.mutate({
      format,
      data: text,
      deckName: file.name.replace(/\.(csv|json)$/i, ''),
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Flashcards</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {totalDue > 0
              ? `${totalDue} card${totalDue === 1 ? '' : 's'} due for review`
              : 'Nothing due right now'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImport(file);
              event.target.value = '';
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={importDeck.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" aria-hidden />
            Import
          </Button>

          <Button size="sm" onClick={() => setCreating((open) => !open)}>
            <Plus className="h-4 w-4" aria-hidden />
            New deck
          </Button>

          {totalDue > 0 ? (
            <Link href="/flashcards/review">
              <Button size="sm" variant="primary">
                <Play className="h-4 w-4" aria-hidden />
                Review all
              </Button>
            </Link>
          ) : null}
        </div>
      </header>

      {creating ? (
        <Card>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!newName.trim()) return;
              createDeck.mutate(
                { name: newName.trim() },
                {
                  onSuccess: () => {
                    setNewName('');
                    setCreating(false);
                  },
                },
              );
            }}
          >
            <div className="min-w-0 flex-1">
              <Input
                label="Deck name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Organic chemistry — reactions"
                autoFocus
              />
            </div>
            <Button type="submit" loading={createDeck.isPending}>
              Create
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </form>
        </Card>
      ) : null}

      {stats && stats.totalCards > 0 ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Review activity</CardTitle>
              <span className="text-xs text-fg-subtle">
                {stats.reviewsTotal} reviews all time
              </span>
            </CardHeader>
            <HeatmapGrid data={stats.heatmap} />
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Card breakdown</CardTitle>
            </CardHeader>
            <dl className="space-y-2.5 text-sm">
              {[
                ['Total', stats.totalCards],
                ['Due today', stats.dueToday],
                ['New', stats.newCards],
                ['Learning', stats.learningCards],
                ['Mature', stats.matureCards],
                ['Suspended', stats.suspendedCards],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex items-center justify-between">
                  <dt className="text-fg-muted">{label}</dt>
                  <dd className="tabular-nums font-medium">{value}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-border pt-2.5">
                <dt className="text-fg-muted">Retention</dt>
                <dd className="tabular-nums font-medium text-success">
                  {stats.retentionRate}%
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-fg-muted">Average ease</dt>
                <dd className="tabular-nums font-medium">{stats.averageEase}</dd>
              </div>
            </dl>
          </Card>
        </div>
      ) : null}

      {isError ? (
        <Card className="text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-warning" aria-hidden />
          <p className="mt-3 font-medium">Could not load decks</p>
          <p className="mt-1 text-sm text-fg-muted">{apiErrorMessage(error)}</p>
        </Card>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-40 w-full rounded-2xl" />
          ))}
        </div>
      ) : !decks || decks.length === 0 ? (
        <Card className="py-14 text-center">
          <Layers className="mx-auto h-10 w-10 text-fg-subtle" aria-hidden />
          <p className="mt-3 font-medium">No decks yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">
            Create a deck and add cards by hand, import a file, or generate them
            from your notes with AI.
          </p>
          <Button className="mt-4" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Create your first deck
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map((deck) => (
            <article
              key={deck.id}
              className="group flex flex-col rounded-2xl border border-border bg-surface p-5 transition-all hover:-translate-y-0.5 hover:border-brand/40"
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                  style={{ backgroundColor: `${deck.color}22`, border: `1px solid ${deck.color}44` }}
                >
                  <Layers className="h-5 w-5" style={{ color: deck.color }} aria-hidden />
                </span>

                {deck.dueCards > 0 ? (
                  <span className="rounded-full border border-brand/30 bg-brand/12 px-2 py-0.5 text-xs font-medium text-brand-bright">
                    {deck.dueCards} due
                  </span>
                ) : null}
              </div>

              <Link href={`/flashcards/${deck.id}`} className="mt-3 flex-1">
                <h3 className="font-medium hover:text-brand-bright">{deck.name}</h3>
                {deck.description ? (
                  <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{deck.description}</p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-subtle">
                  <span>{deck.totalCards} cards</span>
                  <span>{deck.newCards} new</span>
                  <span>{deck.matureCards} mature</span>
                </div>
              </Link>

              <div className="mt-4 flex items-center gap-1 border-t border-border pt-3">
                {deck.dueCards > 0 ? (
                  <Link href={`/flashcards/review?deckId=${deck.id}`}>
                    <Button size="sm">
                      <Play className="h-3.5 w-3.5" aria-hidden />
                      Review
                    </Button>
                  </Link>
                ) : (
                  <Link href={`/flashcards/${deck.id}`}>
                    <Button size="sm" variant="secondary">
                      <Brain className="h-3.5 w-3.5" aria-hidden />
                      Manage
                    </Button>
                  </Link>
                )}

                <a
                  href={`${API_URL}/api/v1/decks/${deck.id}/export?format=json`}
                  className="ml-auto rounded-lg p-2 text-fg-subtle opacity-0 transition-all hover:bg-surface-raised hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`Export ${deck.name}`}
                >
                  <Download className="h-4 w-4" aria-hidden />
                </a>

                <button
                  type="button"
                  aria-label={`Delete ${deck.name}`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete "${deck.name}" and all ${deck.totalCards} cards? This cannot be undone.`,
                      )
                    ) {
                      deleteDeck.mutate(deck.id);
                    }
                  }}
                  className="rounded-lg p-2 text-fg-subtle opacity-0 transition-all hover:bg-danger/12 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
