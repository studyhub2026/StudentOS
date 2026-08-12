'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ClipboardList, GraduationCap, Search, StickyNote, X } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { newMindId } from './ids';
import { useMindMapEditor, type MindNode } from '@/stores/mind-map-editor-store';
import type { ApiEnvelope } from '@/types/api';

interface Library {
  subjects: { id: string; name: string; color: string; code: string | null }[];
  notes: { id: string; title: string; subjectId: string | null; excerpt: string | null }[];
  assignments: {
    id: string;
    title: string;
    subjectId: string | null;
    status: string;
    dueAt: string | null;
  }[];
}

/**
 * A slide-out panel that lets students drop existing subjects, notes, or
 * assignments into the current map as reference nodes. The nodes carry
 * `refType`/`refId` so the inspector can deep-link back to the original.
 */
export function LibraryPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'subjects' | 'notes' | 'assignments'>('subjects');

  const { data, isLoading } = useQuery<Library>({
    queryKey: ['mind-map-library', search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const { data } = await apiClient.get<ApiEnvelope<Library>>(
        `/mind-maps/library${params.toString() ? `?${params.toString()}` : ''}`,
      );
      return data.data;
    },
    enabled: open,
    staleTime: 60_000,
  });

  const addNode = useMindMapEditor((s) => s.addNode);
  const pushHistory = useMindMapEditor((s) => s.pushHistory);

  function insert(refType: string, refId: string, title: string, meta: Record<string, unknown> = {}) {
    pushHistory();
    // Drop near the viewport centre — the editor's own pane owns coord math,
    // so we use a safe default here and let auto-layout reposition if used.
    const id = newMindId('n');
    const node: MindNode = {
      id,
      type: 'mind',
      position: { x: 0, y: 0 },
      data: {
        title,
        content: null,
        type: refType,
        color: null,
        icon: null,
        tags: [],
        refType,
        refId,
        parentId: null,
        metadata: meta,
      },
    };
    addNode(node);
  }

  if (!open) return null;

  return (
    <aside className="fixed right-0 top-14 z-20 flex h-[calc(100vh-3.5rem)] w-80 flex-col border-l border-border bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-sm font-semibold">Add from library</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-fg-subtle hover:text-fg"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-3">
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full rounded-lg border border-border bg-surface-raised py-1.5 pl-8 pr-2 text-xs outline-none focus:border-brand"
          />
        </div>

        <div className="flex gap-1 rounded-lg bg-surface-raised/60 p-0.5">
          {(['subjects', 'notes', 'assignments'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                'flex-1 rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors',
                tab === k ? 'bg-brand/12 text-brand-bright' : 'text-fg-muted hover:text-fg',
              )}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {isLoading ? (
          <p className="text-xs text-fg-subtle">Loading…</p>
        ) : tab === 'subjects' ? (
          <ul className="space-y-1">
            {data?.subjects.length === 0 ? (
              <p className="mt-4 text-center text-xs text-fg-subtle">No subjects found.</p>
            ) : null}
            {data?.subjects.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => insert('subject', s.id, s.name)}
                  className="flex w-full items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-left text-xs hover:border-brand/40 hover:bg-surface-raised"
                >
                  <span
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md"
                    style={{ backgroundColor: `${s.color}22`, color: s.color }}
                  >
                    <GraduationCap className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{s.name}</span>
                    {s.code ? <span className="ml-1 text-fg-subtle">{s.code}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : tab === 'notes' ? (
          <ul className="space-y-1">
            {data?.notes.length === 0 ? (
              <p className="mt-4 text-center text-xs text-fg-subtle">No notes found.</p>
            ) : null}
            {data?.notes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => insert('note', n.id, n.title)}
                  className="flex w-full items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-left text-xs hover:border-brand/40 hover:bg-surface-raised"
                >
                  <StickyNote className="h-3.5 w-3.5 shrink-0 text-teal" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{n.title}</span>
                    {n.excerpt ? (
                      <span className="ml-1 line-clamp-1 text-fg-subtle">{n.excerpt}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-1">
            {data?.assignments.length === 0 ? (
              <p className="mt-4 text-center text-xs text-fg-subtle">No assignments found.</p>
            ) : null}
            {data?.assignments.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => insert('assignment', a.id, a.title, { status: a.status })}
                  className="flex w-full items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-left text-xs hover:border-brand/40 hover:bg-surface-raised"
                >
                  <ClipboardList className="h-3.5 w-3.5 shrink-0 text-warning" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{a.title}</span>
                    {a.dueAt ? (
                      <span className="ml-1 text-fg-subtle">
                        · due {new Date(a.dueAt).toLocaleDateString()}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="border-t border-border px-3 py-2 text-[10px] text-fg-subtle">
        <BookOpen className="mr-1 inline h-3 w-3" />
        Reference nodes deep-link back to the original.
      </p>
    </aside>
  );
}
