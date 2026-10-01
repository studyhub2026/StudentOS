'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChevronLeft, ChevronRight, ExternalLink, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { metaFor } from './node-icons';
import { useMindMapEditor } from '@/stores/mind-map-editor-store';

/**
 * React Flow node renderer — a minimal outline-tree node modelled after
 * Google NotebookLM / classic mind-mapping tools. Each node is a tinted
 * rounded card showing only its title; the type, description, tags and
 * other metadata still live in the data model and surface in the
 * NodeInspector panel on selection.
 *
 * Handles are on the LEFT (target) and RIGHT (source) because the layout
 * is horizontal — children fan out to the right of their parent.
 *
 * The branch collapse control sits on the node's right edge, right where
 * the connectors to the children emerge, so one click folds the whole
 * subtree back into the parent.
 */
function MindNodeInner({ id, data, selected }: NodeProps<import('@/stores/mind-map-editor-store').MindNode>) {
  const meta = metaFor(data.type);
  const color = data.color ?? meta.color;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.title);
  const updateNode = useMindMapEditor((s) => s.updateNode);
  const pushHistory = useMindMapEditor((s) => s.pushHistory);
  const toggleCollapse = useMindMapEditor((s) => s.toggleCollapse);
  const inputRef = useRef<HTMLInputElement>(null);

  const collapsed = !!(data.metadata as Record<string, unknown> | null)?.collapsed;
  const hasChildren = useMindMapEditor(useCallback((s) => s.edges.some((e) => e.source === id), [id]));
  const hiddenCount = useMindMapEditor(
    useCallback(
      (s) => {
        if (!collapsed) return 0;
        const adj = new Map<string, string[]>();
        for (const e of s.edges) {
          if (!adj.has(e.source)) adj.set(e.source, []);
          adj.get(e.source)!.push(e.target);
        }
        let count = 0;
        const queue = [...(adj.get(id) || [])];
        const seen = new Set<string>();
        while (queue.length > 0) {
          const nid = queue.shift()!;
          if (seen.has(nid)) continue;
          seen.add(nid);
          count++;
          queue.push(...(adj.get(nid) || []));
        }
        return count;
      },
      [collapsed, id],
    ),
  );

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

  const isRefNode = Boolean(data.refType && data.refId);
  const aiGenerated = !!(data.metadata as Record<string, unknown> | null)?.aiGenerated;
  const isRoot = data.type === 'root';

  return (
    <div className="group relative">
      <Handle
        type="target"
        position={Position.Left}
        className="!left-0 !top-1/2 !-translate-y-1/2 !bg-brand !w-2 !h-2 !opacity-0 group-hover:!opacity-100 !border-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!right-0 !top-1/2 !-translate-y-1/2 !bg-brand !w-2 !h-2 !opacity-0 group-hover:!opacity-100 !border-0"
      />

      <div
        onDoubleClick={() => setEditing(true)}
        className={cn(
          'relative min-w-[160px] max-w-[260px] rounded-lg border px-3.5 py-2 shadow-sm transition-all',
          selected
            ? 'ring-2 ring-brand/50 shadow-md'
            : 'hover:shadow-md',
        )}
        style={{
          backgroundColor: isRoot ? `${color}26` : `${color}12`,
          borderColor: selected ? undefined : `${color}66`,
        }}
      >
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
            className="w-full rounded border border-brand/40 bg-transparent px-1 py-0.5 text-sm font-medium outline-none"
          />
        ) : (
          <p
            className={cn(
              'break-words text-sm leading-snug',
              isRoot ? 'font-semibold' : 'font-medium',
            )}
            style={{ color: isRoot ? color : 'var(--color-fg)' }}
          >
            {data.title}
          </p>
        )}

        {(aiGenerated || isRefNode) && !editing ? (
          <div className="absolute right-1.5 top-1 flex items-center gap-0.5">
            {isRefNode ? (
              <ExternalLink className="h-2.5 w-2.5 text-fg-subtle" aria-label="Linked" />
            ) : null}
            {aiGenerated ? (
              <Sparkles className="h-2.5 w-2.5 text-brand-bright" aria-label="AI generated" />
            ) : null}
          </div>
        ) : null}
      </div>

      {hasChildren ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleCollapse(id);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={cn(
            'absolute top-1/2 -right-3 z-10 flex h-6 -translate-y-1/2 items-center justify-center rounded-full border bg-[var(--color-surface)] shadow-sm transition-colors',
            collapsed
              ? 'min-w-[1.5rem] gap-0.5 px-1.5 text-brand hover:bg-brand/10'
              : 'w-6 text-fg-muted hover:bg-surface-raised hover:text-fg',
          )}
          style={{
            borderColor: collapsed ? color : undefined,
          }}
          aria-label={collapsed ? `Expand branch (${hiddenCount} hidden)` : 'Collapse branch'}
          title={collapsed ? `Expand · ${hiddenCount} hidden` : 'Collapse branch'}
        >
          {collapsed ? (
            <>
              <ChevronRight className="h-3 w-3" />
              <span className="text-[10px] font-semibold leading-none">{hiddenCount}</span>
            </>
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
      ) : null}
    </div>
  );
}

export const MindNodeView = memo(MindNodeInner);
