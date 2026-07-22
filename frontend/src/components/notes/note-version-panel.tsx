'use client';

import { useEffect } from 'react';
import { History, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useNoteVersions, useRestoreVersion } from '@/hooks/use-notes';

interface NoteVersionPanelProps {
  noteId: string;
  onClose: () => void;
}

export function NoteVersionPanel({ noteId, onClose }: NoteVersionPanelProps) {
  const { data: versions, isLoading } = useNoteVersions(noteId);
  const restore = useRestoreVersion();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Version history"
    >
      <button
        type="button"
        aria-label="Close version history"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <aside className="glass relative flex h-full w-full max-w-sm flex-col p-5">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <History className="h-4 w-4 text-brand-bright" aria-hidden />
            Version history
          </h2>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
          ) : !versions || versions.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-fg-muted">No earlier versions yet.</p>
              <p className="mt-1 text-xs text-fg-subtle">
                A snapshot is kept each time the note&apos;s content changes.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {versions.map((version) => (
                <li
                  key={version.id}
                  className="rounded-xl border border-border bg-surface p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{version.title}</p>
                      <p className="mt-0.5 text-xs text-fg-subtle">
                        v{version.version} · {version.wordCount} words ·{' '}
                        {version.automatic ? 'autosaved' : 'saved'}
                      </p>
                      <p className="text-xs text-fg-subtle">
                        {new Date(version.createdAt).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      loading={restore.isPending}
                      onClick={() =>
                        restore.mutate(
                          { noteId, versionId: version.id },
                          { onSuccess: onClose },
                        )
                      }
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      Restore
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-3 border-t border-border pt-3 text-xs text-fg-subtle">
          Restoring keeps the current text as a new version, so it can be undone.
        </p>
      </aside>
    </div>
  );
}
