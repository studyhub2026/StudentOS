'use client';

import { useMemo, useState } from 'react';
import {
  Check,
  Menu,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { usePinConversation, useRenameConversation, type ConversationSummary } from '@/hooks/use-ai';
import { useT } from '@/lib/i18n/provider';

function groupLabel(updatedAt: string): string {
  const now = new Date();
  const date = new Date(updatedAt);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 7) return 'Previous 7 days';
  if (diffDays <= 30) return 'Previous 30 days';
  return 'Older';
}

const GROUP_ORDER = ['Pinned', 'Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older'];

function groupConversations(items: ConversationSummary[]) {
  const groups = new Map<string, ConversationSummary[]>();
  for (const c of items) {
    const key = c.pinned ? 'Pinned' : groupLabel(c.updatedAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  return GROUP_ORDER.map((key) => ({ key, items: groups.get(key) ?? [] })).filter(
    (g) => g.items.length > 0,
  );
}

interface Props {
  conversations: ConversationSummary[] | undefined;
  loadingList: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function ConversationSidebar({
  conversations,
  loadingList,
  selectedId,
  onSelect,
  onNew,
  onDelete,
  mobileOpen,
  onCloseMobile,
}: Props) {
  const t = useT();
  const [search, setSearch] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const rename = useRenameConversation();
  const pin = usePinConversation();

  const filtered = useMemo(() => {
    if (!conversations) return [];
    const q = search.trim().toLowerCase();
    return q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
  }, [conversations, search]);

  const groups = useMemo(() => groupConversations(filtered), [filtered]);

  function startRename(c: ConversationSummary) {
    setRenamingId(c.id);
    setRenameDraft(c.title);
  }

  function commitRename() {
    const title = renameDraft.trim();
    if (renamingId && title) rename.mutate({ id: renamingId, title });
    setRenamingId(null);
  }

  const body = (
    <>
      <Button className="w-full" onClick={onNew}>
        <Plus className="h-4 w-4" aria-hidden />
        {t('ai.newChat')}
      </Button>

      <div className="relative mt-3">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search conversations…"
          aria-label="Search conversations"
          className="w-full rounded-lg border border-border bg-surface-raised py-1.5 pl-8 pr-2 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
        />
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
        {loadingList ? (
          Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-11 w-full rounded-xl" />)
        ) : groups.length > 0 ? (
          groups.map((group) => (
            <div key={group.key}>
              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-widest text-fg-subtle">
                {group.key}
              </p>
              <div className="space-y-1">
                {group.items.map((c) => (
                  <div
                    key={c.id}
                    className={cn(
                      'group flex items-center gap-1 rounded-xl border px-2 py-2 text-sm transition-colors',
                      c.id === selectedId
                        ? 'border-brand bg-brand/10 text-brand-bright'
                        : 'border-transparent hover:bg-surface-raised',
                    )}
                  >
                    {renamingId === c.id ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitRename();
                          } else if (e.key === 'Escape') {
                            setRenamingId(null);
                          }
                        }}
                        onBlur={commitRename}
                        className="min-w-0 flex-1 rounded border border-brand/40 bg-surface px-1.5 py-0.5 text-sm outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(c.id);
                          onCloseMobile();
                        }}
                        className="min-w-0 flex-1 truncate text-left"
                        title={c.title}
                      >
                        {c.pinned ? <Pin className="mr-1 inline h-3 w-3 shrink-0 text-brand-bright" aria-hidden /> : null}
                        {c.title}
                      </button>
                    )}

                    {renamingId === c.id ? (
                      <button
                        type="button"
                        aria-label="Save name"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={commitRename}
                        className="shrink-0 text-fg-subtle hover:text-success"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    ) : (
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <button
                          type="button"
                          aria-label={c.pinned ? `Unpin ${c.title}` : `Pin ${c.title}`}
                          onClick={() => pin.mutate({ id: c.id, pinned: !c.pinned })}
                          className="rounded p-1 text-fg-subtle hover:text-brand-bright"
                        >
                          {c.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          aria-label={`Rename ${c.title}`}
                          onClick={() => startRename(c)}
                          className="rounded p-1 text-fg-subtle hover:text-fg"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${c.title}`}
                          onClick={() => onDelete(c.id)}
                          className="rounded p-1 text-fg-subtle hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="px-3 py-6 text-center text-xs text-fg-subtle">
            {search ? 'No matching conversations.' : 'No conversations yet.'}
          </p>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: static column */}
      <aside className="hidden w-64 shrink-0 flex-col md:flex">{body}</aside>

      {/* Mobile: drawer overlay */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onCloseMobile}
            aria-hidden
          />
          <div className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-border bg-[var(--color-surface)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">Conversations</p>
              <button
                type="button"
                onClick={onCloseMobile}
                aria-label="Close conversation list"
                className="rounded p-1 text-fg-subtle hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {body}
          </div>
        </div>
      ) : null}
    </>
  );
}

export function MobileSidebarToggle({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Open conversation list"
      onClick={onClick}
      className="md:hidden"
    >
      <Menu className="h-4 w-4" aria-hidden />
    </Button>
  );
}
