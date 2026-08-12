'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ExternalLink, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { metaFor } from './node-icons';
import { useMindMapEditor } from '@/stores/mind-map-editor-store';

/**
 * React Flow node renderer. Handles inline title edit on double-click and
 * exposes 4-sided connection handles so users can wire nodes in any
 * direction. Selected state uses OmnelOS brand tokens so it matches the
 * rest of the app.
 */
function MindNodeInner({ id, data, selected }: NodeProps<import('@/stores/mind-map-editor-store').MindNode>) {
  const meta = metaFor(data.type);
  const Icon = meta.icon;
  const color = data.color ?? meta.color;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.title);
  const updateNode = useMindMapEditor((s) => s.updateNode);
  const pushHistory = useMindMapEditor((s) => s.pushHistory);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    // Keep local draft in sync when the underlying data changes externally
    // (e.g. undo/redo, AI expand).
    if (!editing) setDraft(data.title);
  }, [data.title, editing]);

  function commitEdit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== data.title) {
      pushHistory();
      updateNode(id, { title: next });
    } else {
      setDraft(data.title);
    }
  }

  const isRefNode = data.refType && data.refId;

  return (
    <div
      onDoubleClick={() => setEditing(true)}
      className={cn(
        'group relative min-w-[160px] max-w-[280px] rounded-2xl border bg-[var(--color-surface)] text-[var(--color-fg)] shadow-sm transition-shadow',
        selected
          ? 'ring-2 ring-brand shadow-md border-brand/60'
          : 'border-border hover:shadow-md',
      )}
      style={{ borderTopColor: color, borderTopWidth: 3 }}
    >
      {/* Connection handles on all four sides so students can wire in any
          direction without dragging out of a single handle. */}
      {/* Single unambiguous handle pair — React Flow v12 struggles to route
          edges when a node exposes multiple handles of the same type without
          the edge explicitly picking one. Handles are visually centred on
          the node with `!left-1/2 !top-1/2` and hidden except when hovering
          via CSS below, so the connection UX still feels 360°. */}
      <Handle
        type="target"
        position={Position.Top}
        className="!left-1/2 !top-0 !-translate-x-1/2 !bg-brand !w-2 !h-2 !opacity-0 group-hover:!opacity-100"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!left-1/2 !bottom-0 !-translate-x-1/2 !bg-brand !w-2 !h-2 !opacity-0 group-hover:!opacity-100"
      />

      <div className="flex items-center gap-2 px-3 pt-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: `${color}22`, color }}
          aria-hidden
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-[10px] font-medium uppercase tracking-widest text-fg-subtle">
          {meta.label}
        </span>
        {isRefNode ? (
          <ExternalLink className="ml-auto h-3 w-3 text-fg-subtle" aria-label="Linked" />
        ) : null}
        {data.metadata && (data.metadata as Record<string, unknown>).aiGenerated ? (
          <Sparkles className="ml-auto h-3 w-3 text-brand-bright" aria-label="AI generated" />
        ) : null}
      </div>

      <div className="px-3 pb-3 pt-1">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitEdit();
              } else if (e.key === 'Escape') {
                setEditing(false);
                setDraft(data.title);
              }
              e.stopPropagation();
            }}
            className="w-full rounded-md border border-brand/30 bg-transparent px-1.5 py-0.5 text-sm font-semibold outline-none"
          />
        ) : (
          <p className="break-words text-sm font-semibold leading-tight">{data.title}</p>
        )}
        {data.content && !editing ? (
          <p className="mt-1 line-clamp-3 text-xs text-fg-muted">{data.content}</p>
        ) : null}
        {data.tags && data.tags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {data.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="rounded-md bg-surface-raised px-1.5 py-0.5 text-[10px] text-fg-muted"
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const MindNodeView = memo(MindNodeInner);
