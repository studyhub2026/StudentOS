'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Client-side PDF library: remembers the list of PDFs the student has opened
 * so the empty state can offer "Recent" chips. The file blobs themselves are
 * NOT stored (browser security stops us reopening them without a user click),
 * only their metadata — reopening a recent still triggers the file picker.
 *
 * Bookmarks are per-PDF text snippets keyed by `${name}|${size}` so the same
 * document across different devices resolves the same set.
 */

export interface PdfMeta {
  name: string;
  size: number;
  lastOpened: string;
}

export interface PdfBookmark {
  id: string;
  createdAt: string;
  page?: number;
  text: string;
  note?: string;
}

const LIBRARY_KEY = 'studentos.pdf.library';
const BOOKMARK_PREFIX = 'studentos.pdf.bookmarks.';
const MAX_RECENT = 8;

function bookmarkKey(name: string, size: number): string {
  return `${BOOKMARK_PREFIX}${name}|${size}`;
}

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded — silently drop */
  }
}

export function useRecentPdfs() {
  const [recent, setRecent] = useState<PdfMeta[]>([]);

  useEffect(() => {
    setRecent(safeRead<PdfMeta[]>(LIBRARY_KEY, []));
  }, []);

  const record = useCallback((name: string, size: number) => {
    setRecent((prev) => {
      const filtered = prev.filter((p) => !(p.name === name && p.size === size));
      const next: PdfMeta[] = [
        { name, size, lastOpened: new Date().toISOString() },
        ...filtered,
      ].slice(0, MAX_RECENT);
      safeWrite(LIBRARY_KEY, next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setRecent([]);
    safeWrite(LIBRARY_KEY, []);
  }, []);

  return { recent, record, clear };
}

export function usePdfBookmarks(name: string | null, size: number | null) {
  const [bookmarks, setBookmarks] = useState<PdfBookmark[]>([]);

  useEffect(() => {
    if (!name || size === null) {
      setBookmarks([]);
      return;
    }
    setBookmarks(safeRead<PdfBookmark[]>(bookmarkKey(name, size), []));
  }, [name, size]);

  const add = useCallback(
    (text: string, opts?: { page?: number; note?: string }) => {
      if (!name || size === null) return;
      const trimmed = text.trim().slice(0, 4000);
      if (!trimmed) return;
      setBookmarks((prev) => {
        const entry: PdfBookmark = {
          id: `${Date.now()}-${Math.floor(prev.length + 1)}`,
          createdAt: new Date().toISOString(),
          text: trimmed,
          ...(opts?.page ? { page: opts.page } : {}),
          ...(opts?.note ? { note: opts.note.slice(0, 500) } : {}),
        };
        const next = [entry, ...prev].slice(0, 100);
        safeWrite(bookmarkKey(name, size), next);
        return next;
      });
    },
    [name, size],
  );

  const remove = useCallback(
    (id: string) => {
      if (!name || size === null) return;
      setBookmarks((prev) => {
        const next = prev.filter((b) => b.id !== id);
        safeWrite(bookmarkKey(name, size), next);
        return next;
      });
    },
    [name, size],
  );

  return { bookmarks, add, remove };
}
