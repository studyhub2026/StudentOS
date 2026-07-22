'use client';

import { useEffect, useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBulkCreateCards, useGenerateCards } from '@/hooks/use-flashcards';
import { apiErrorCode } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { CardDifficulty, GeneratedCard } from '@/types/api';

const DIFFICULTIES: CardDifficulty[] = ['EASY', 'MEDIUM', 'HARD'];

interface AiGenerateDialogProps {
  deckId: string;
  onClose: () => void;
}

/**
 * Two-step AI generation: preview first, then commit only the cards the
 * student keeps. Generated content is never written straight to the deck.
 */
export function AiGenerateDialog({ deckId, onClose }: AiGenerateDialogProps) {
  const [source, setSource] = useState('');
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<CardDifficulty>('MEDIUM');
  const [preview, setPreview] = useState<GeneratedCard[] | null>(null);
  const [rejected, setRejected] = useState<Set<number>>(new Set());

  const generate = useGenerateCards();
  const bulkCreate = useBulkCreateCards();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const aiUnavailable =
    generate.isError && apiErrorCode(generate.error) === 'AI_NOT_CONFIGURED';

  const kept = preview?.filter((_, index) => !rejected.has(index)) ?? [];

  function toggleRejected(index: number) {
    setRejected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Generate cards with AI"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="glass relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl p-6">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4 text-brand-bright" aria-hidden />
            Generate cards with AI
          </h2>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </header>

        {aiUnavailable ? (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
            <p className="font-medium text-warning">AI is not configured on this server</p>
            <p className="mt-1 text-fg-muted">
              A <code className="font-mono text-xs">GEMINI_API_KEY</code> must be set in the
              backend environment. You can still add cards manually or import a file.
            </p>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {preview ? (
            <div className="space-y-2">
              <p className="text-sm text-fg-muted">
                {kept.length} of {preview.length} cards selected. Click a card to exclude it.
              </p>

              {preview.map((card, index) => {
                const excluded = rejected.has(index);
                return (
                  <button
                    key={`${card.front}-${index}`}
                    type="button"
                    onClick={() => toggleRejected(index)}
                    aria-pressed={!excluded}
                    className={cn(
                      'w-full rounded-xl border p-3 text-left transition-colors',
                      excluded
                        ? 'border-border bg-surface opacity-40'
                        : 'border-brand/30 bg-brand/8',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border',
                          excluded ? 'border-border' : 'border-brand bg-brand text-white',
                        )}
                      >
                        {excluded ? null : <Check className="h-3 w-3" aria-hidden />}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{card.front}</p>
                        <p className="mt-1 text-sm text-fg-muted">{card.back}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="ai-source"
                  className="mb-1.5 block text-sm font-medium text-fg-muted"
                >
                  Source material
                </label>
                <textarea
                  id="ai-source"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  rows={8}
                  placeholder="Paste your notes, a textbook passage, or a topic outline…"
                  className="w-full resize-y rounded-xl border border-border bg-surface-raised p-3 text-sm placeholder:text-fg-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                />
                <p className="mt-1 text-xs text-fg-subtle">
                  {source.trim().length} characters · at least 20 needed
                </p>
              </div>

              <div className="flex flex-wrap gap-4">
                <div>
                  <label
                    htmlFor="ai-count"
                    className="mb-1.5 block text-sm font-medium text-fg-muted"
                  >
                    How many cards
                  </label>
                  <input
                    id="ai-count"
                    type="number"
                    min={1}
                    max={50}
                    value={count}
                    onChange={(event) => setCount(Number(event.target.value))}
                    className="h-10 w-24 rounded-xl border border-border bg-surface-raised px-3 text-sm focus:border-brand focus:outline-none"
                  />
                </div>

                <div>
                  <p className="mb-1.5 text-sm font-medium text-fg-muted">Difficulty</p>
                  <div className="flex gap-1.5">
                    {DIFFICULTIES.map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={difficulty === value}
                        onClick={() => setDifficulty(value)}
                        className={cn(
                          'h-10 rounded-xl border px-3 text-xs transition-colors',
                          difficulty === value
                            ? 'border-brand bg-brand/15 text-brand-bright'
                            : 'border-border text-fg-muted hover:border-border-strong',
                        )}
                      >
                        {value.charAt(0) + value.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          {preview ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setPreview(null);
                  setRejected(new Set());
                }}
              >
                Back
              </Button>
              <Button
                loading={bulkCreate.isPending}
                disabled={kept.length === 0}
                onClick={() =>
                  bulkCreate.mutate(
                    {
                      deckId,
                      cards: kept.map((card) => ({
                        front: card.front,
                        back: card.back,
                        hint: card.hint,
                        difficulty: card.difficulty,
                      })),
                    },
                    { onSuccess: onClose },
                  )
                }
              >
                Add {kept.length} card{kept.length === 1 ? '' : 's'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                loading={generate.isPending}
                disabled={source.trim().length < 20}
                onClick={() =>
                  generate.mutate(
                    { deckId, source: source.trim(), count, difficulty, save: false },
                    { onSuccess: (result) => setPreview(result.cards) },
                  )
                }
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Generate preview
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
