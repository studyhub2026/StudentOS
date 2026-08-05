'use client';

import { useCallback, useEffect, useState } from 'react';

const RECENT_KEY = 'studentos.search.recent';
const PINNED_KEY = 'studentos.search.pinned';
const MAX_RECENT = 8;
const MAX_PINNED = 12;

/**
 * localStorage-backed search history. Kept client-side because it is a
 * personal UX affordance, not shared data — writing it to Postgres would
 * add a chatty API surface for zero cross-device value.
 */
function readList(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* quota exceeded or storage disabled — silently drop */
  }
}

export function useSearchHistory() {
  const [recent, setRecent] = useState<string[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    setRecent(readList(RECENT_KEY));
    setPinned(readList(PINNED_KEY));
  }, []);

  const record = useCallback((raw: string) => {
    const q = raw.trim();
    if (q.length < 2) return;
    setRecent((prev) => {
      const next = [q, ...prev.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(
        0,
        MAX_RECENT,
      );
      writeList(RECENT_KEY, next);
      return next;
    });
  }, []);

  const clearRecent = useCallback(() => {
    setRecent([]);
    writeList(RECENT_KEY, []);
  }, []);

  const togglePin = useCallback((raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setPinned((prev) => {
      const exists = prev.some((r) => r.toLowerCase() === q.toLowerCase());
      const next = exists
        ? prev.filter((r) => r.toLowerCase() !== q.toLowerCase())
        : [q, ...prev].slice(0, MAX_PINNED);
      writeList(PINNED_KEY, next);
      return next;
    });
  }, []);

  const isPinned = useCallback(
    (q: string) => pinned.some((r) => r.toLowerCase() === q.trim().toLowerCase()),
    [pinned],
  );

  return { recent, pinned, record, clearRecent, togglePin, isPinned };
}
