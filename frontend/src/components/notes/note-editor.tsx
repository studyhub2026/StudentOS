'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Eye,
  History,
  Loader2,
  Pencil,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { MarkdownPreview } from './markdown-preview';
import { FileUploader } from '@/components/uploads/file-uploader';
import { Button } from '@/components/ui/button';
import { useAutosaveNote, useSummariseNote, useToggleFavorite } from '@/hooks/use-notes';
import { cn } from '@/lib/utils';
import type { Note } from '@/types/api';

const AUTOSAVE_DELAY_MS = 1200;

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

interface NoteEditorProps {
  note: Note;
  onClose: () => void;
  onOpenHistory: () => void;
}

export function NoteEditor({ note, onClose, onOpenHistory }: NoteEditorProps) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const autosave = useAutosaveNote();
  const summarise = useSummariseNote();
  const toggleFavorite = useToggleFavorite();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks what the server last accepted, so autosave can skip no-op saves.
  const savedRef = useRef({ title: note.title, content: note.content });

  // Switching to a different note replaces the buffer wholesale.
  useEffect(() => {
    setTitle(note.title);
    setContent(note.content);
    savedRef.current = { title: note.title, content: note.content };
    setSaveState('idle');
  }, [note.id, note.title, note.content]);

  const flush = useCallback(
    async (nextTitle: string, nextContent: string) => {
      if (
        nextTitle === savedRef.current.title &&
        nextContent === savedRef.current.content
      ) {
        setSaveState('saved');
        return;
      }

      setSaveState('saving');
      try {
        await autosave.mutateAsync({ id: note.id, content: nextContent, title: nextTitle });
        savedRef.current = { title: nextTitle, content: nextContent };
        setSaveState('saved');
      } catch {
        // Kept local: the buffer still holds the user's text, so nothing is
        // lost and the next keystroke retries.
        setSaveState('error');
      }
    },
    [autosave, note.id],
  );

  // Debounced autosave on every edit.
  useEffect(() => {
    if (title === savedRef.current.title && content === savedRef.current.content) return;

    setSaveState('pending');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(title, content), AUTOSAVE_DELAY_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [title, content, flush]);

  // Ctrl/Cmd+S saves immediately rather than waiting out the debounce.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (timerRef.current) clearTimeout(timerRef.current);
        void flush(title, content);
      }
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [title, content, flush, onClose]);

  // Save any pending edits when the editor unmounts.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const saveLabel: Record<SaveState, string> = {
    idle: '',
    pending: 'Unsaved changes',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed — retrying on next edit',
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="Note title"
          placeholder="Untitled note"
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-fg-subtle"
        />

        <span
          className={cn(
            'flex shrink-0 items-center gap-1.5 text-xs',
            saveState === 'error' ? 'text-danger' : 'text-fg-subtle',
          )}
          aria-live="polite"
        >
          {saveState === 'saving' ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
          {saveState === 'saved' ? <Check className="h-3 w-3 text-success" aria-hidden /> : null}
          {saveLabel[saveState]}
        </span>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={note.favorite ? 'Remove from favourites' : 'Add to favourites'}
            aria-pressed={note.favorite}
            onClick={() => toggleFavorite.mutate({ id: note.id, favorite: !note.favorite })}
          >
            <Star
              className={cn('h-4 w-4', note.favorite && 'fill-warning text-warning')}
              aria-hidden
            />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            aria-label="Version history"
            onClick={onOpenHistory}
          >
            <History className="h-4 w-4" aria-hidden />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            aria-label={mode === 'write' ? 'Preview' : 'Edit'}
            onClick={() => setMode(mode === 'write' ? 'preview' : 'write')}
          >
            {mode === 'write' ? <Eye className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          </Button>

          <Button variant="ghost" size="icon" aria-label="Close editor" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {mode === 'write' ? (
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            aria-label="Note content"
            placeholder="Start writing… Markdown is supported."
            spellCheck
            className="h-full min-h-[24rem] w-full resize-none bg-transparent font-mono text-[15px] leading-relaxed outline-none placeholder:text-fg-subtle"
          />
        ) : (
          <MarkdownPreview content={content} />
        )}

        <div className="mt-4 border-t border-border pt-4">
          <FileUploader
            folder="notes"
            target={{ noteId: note.id }}
            attachments={note.attachments}
          />
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-fg-subtle">
        <span>
          {content.trim() === '' ? 0 : content.trim().split(/\s+/).length} words · Ctrl+S to save
        </span>

        <Button
          variant="ghost"
          size="sm"
          loading={summarise.isPending}
          disabled={content.trim().length < 40}
          onClick={() => summarise.mutate(note.id)}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Summarise with AI
        </Button>
      </footer>

      {summarise.data ? (
        <div className="border-t border-brand/25 bg-brand/8 px-4 py-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-brand-bright">
            AI summary
          </p>
          <p className="text-sm text-fg-muted">{summarise.data.summary}</p>
          {summarise.data.keyPoints.length > 0 ? (
            <ul className="mt-2 ml-4 list-disc space-y-1">
              {summarise.data.keyPoints.map((point) => (
                <li key={point} className="text-sm text-fg-muted">
                  {point}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
