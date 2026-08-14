'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, GraduationCap, Search, StickyNote, X } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { ApiEnvelope } from '@/types/api';

export interface ContextRef {
  type: 'note' | 'subject' | 'document';
  id: string;
  label: string;
}

/**
 * Popover picker for attaching academic context (notes / subjects / KB docs)
 * to the next chat message. Reuses the existing mind-map library endpoints —
 * both are ownership-scoped, so a user can only ever see their own material.
 * The picker only ever holds ids + labels; the actual content is fetched and
 * bounded server-side.
 */
export function ContextPicker({
  selected,
  onToggle,
  onClose,
}: {
  selected: ContextRef[];
  onToggle: (ref: ContextRef) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'note' | 'subject' | 'document'>('note');
  const [search, setSearch] = useState('');

  const { data: base } = useQuery({
    queryKey: ['mind-map-library', search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const { data } = await apiClient.get<
        ApiEnvelope<{
          subjects: { id: string; name: string; code: string | null }[];
          notes: { id: string; title: string }[];
        }>
      >(`/mind-maps/library${params.toString() ? `?${params.toString()}` : ''}`);
      return data.data;
    },
    enabled: tab === 'note' || tab === 'subject',
    staleTime: 60_000,
  });

  const { data: ext } = useQuery({
    queryKey: ['mind-map-library-extended', search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const { data } = await apiClient.get<
        ApiEnvelope<{ documents: { id: string; filename: string }[] }>
      >(`/mind-maps/library-extended${params.toString() ? `?${params.toString()}` : ''}`);
      return data.data;
    },
    enabled: tab === 'document',
    staleTime: 60_000,
  });

  const items: ContextRef[] =
    tab === 'note'
      ? (base?.notes ?? []).map((n) => ({ type: 'note', id: n.id, label: n.title }))
      : tab === 'subject'
        ? (base?.subjects ?? []).map((s) => ({ type: 'subject', id: s.id, label: s.name }))
        : (ext?.documents ?? []).map((d) => ({ type: 'document', id: d.id, label: d.filename }));

  const isSelected = (r: ContextRef) => selected.some((s) => s.type === r.type && s.id === r.id);

  return (
    <div className="absolute bottom-full left-0 z-30 mb-2 w-72 rounded-xl border border-border bg-[var(--color-surface)] p-2 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold">Attach context</p>
        <button type="button" onClick={onClose} className="rounded p-1 text-fg-subtle hover:text-fg" aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-2 flex gap-1 rounded-lg bg-surface-raised/60 p-0.5">
        {(
          [
            { k: 'note', label: 'Notes', icon: StickyNote },
            { k: 'subject', label: 'Subjects', icon: GraduationCap },
            { k: 'document', label: 'KB', icon: BookOpen },
          ] as const
        ).map(({ k, label, icon: Icon }) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              tab === k ? 'bg-brand/12 text-brand-bright' : 'text-fg-muted hover:text-fg',
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      <div className="relative mb-1.5">
        <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-subtle" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="w-full rounded-lg border border-border bg-surface-raised py-1 pl-7 pr-2 text-xs outline-none focus:border-brand"
        />
      </div>

      <div className="max-h-52 overflow-y-auto">
        {items.length === 0 ? (
          <p className="py-4 text-center text-xs text-fg-subtle">Nothing found.</p>
        ) : (
          items.map((it) => (
            <button
              key={`${it.type}-${it.id}`}
              type="button"
              onClick={() => onToggle(it)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                isSelected(it) ? 'bg-brand/10 text-brand-bright' : 'hover:bg-surface-raised',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {isSelected(it) ? <span className="text-[10px]">✓</span> : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
