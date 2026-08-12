'use client';

import { useEffect, useState } from 'react';
import { HelpCircle, Layers, Lightbulb, Loader2, Sparkles, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useMindMapEditor } from '@/stores/mind-map-editor-store';
import { NODE_TYPE_META } from './node-icons';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

/**
 * Right-side inspector panel for the currently-selected node. Simple form
 * against the store — every change goes through `updateNode` so it flows
 * into the dirty tracker and the auto-save loop.
 */
export function NodeInspector({ mapId }: { mapId?: string }) {
  const selectedId = useMindMapEditor((s) => s.selectedNodeId);
  const node = useMindMapEditor((s) => s.nodes.find((n) => n.id === selectedId) ?? null);
  const updateNode = useMindMapEditor((s) => s.updateNode);
  const removeNodes = useMindMapEditor((s) => s.removeNodes);
  const setSelectedNode = useMindMapEditor((s) => s.setSelectedNode);
  const pushHistory = useMindMapEditor((s) => s.pushHistory);

  const [tagInput, setTagInput] = useState('');
  const [contentDraft, setContentDraft] = useState('');
  const [aiOutput, setAiOutput] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState<null | string>(null);

  useEffect(() => {
    setContentDraft(node?.data.content ?? '');
    setTagInput('');
    setAiOutput(null);
  }, [node?.id, node?.data.content]);

  async function runAction(action: 'explain-simple' | 'explain-detail' | 'examples' | 'quiz' | 'flashcards' | 'related') {
    if (!node || !mapId) return;
    setAiBusy(action);
    setAiOutput(null);
    try {
      const { data } = await apiClient.post<ApiEnvelope<{ text: string }>>(
        `/mind-maps/${mapId}/nodes/${node.id}/actions`,
        { action },
      );
      setAiOutput(data.data.text);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setAiBusy(null);
    }
  }

  if (!node) {
    return (
      <aside className="w-80 shrink-0 border-l border-border bg-[var(--color-surface)] p-4">
        <p className="text-sm text-fg-muted">Select a node to edit its details.</p>
      </aside>
    );
  }

  const linkHref =
    node.data.refType === 'note' && node.data.refId
      ? `/notes?id=${node.data.refId}`
      : node.data.refType === 'assignment' && node.data.refId
        ? `/assignments`
        : node.data.refType === 'subject' && node.data.refId
          ? `/courses/${node.data.refId}`
          : node.data.refType === 'lms_course' && node.data.refId
            ? `/courses/${node.data.refId}`
            : null;

  return (
    <aside className="w-80 shrink-0 border-l border-border bg-[var(--color-surface)] p-4 overflow-y-auto">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Node details</h3>
        <button
          type="button"
          onClick={() => setSelectedNode(null)}
          className="rounded p-1 text-fg-subtle hover:text-fg"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted" htmlFor="mm-title">
            Title
          </label>
          <input
            id="mm-title"
            className="w-full rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
            value={node.data.title}
            onChange={(e) => updateNode(node.id, { title: e.target.value })}
            onFocus={() => pushHistory()}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted" htmlFor="mm-type">
            Type
          </label>
          <select
            id="mm-type"
            className="w-full rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
            value={node.data.type}
            onChange={(e) => {
              pushHistory();
              updateNode(node.id, { type: e.target.value });
            }}
          >
            {Object.entries(NODE_TYPE_META).map(([key, meta]) => (
              <option key={key} value={key}>
                {meta.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted" htmlFor="mm-content">
            Notes
          </label>
          <textarea
            id="mm-content"
            rows={4}
            className="w-full rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
            value={contentDraft}
            onChange={(e) => setContentDraft(e.target.value)}
            onBlur={() => {
              if (contentDraft !== (node.data.content ?? '')) {
                pushHistory();
                updateNode(node.id, { content: contentDraft || null });
              }
            }}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted">Color</label>
          <input
            type="color"
            value={node.data.color ?? '#8b5cf6'}
            onChange={(e) => updateNode(node.id, { color: e.target.value })}
            className="h-8 w-16 cursor-pointer rounded border border-border"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted">Tags</label>
          <div className="flex flex-wrap gap-1">
            {node.data.tags.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1 rounded-md bg-surface-raised px-1.5 py-0.5 text-xs"
              >
                {t}
                <button
                  type="button"
                  onClick={() =>
                    updateNode(node.id, {
                      tags: node.data.tags.filter((tag) => tag !== t),
                    })
                  }
                  className="text-fg-subtle hover:text-danger"
                  aria-label={`Remove tag ${t}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <input
            className="mt-1 w-full rounded-lg border border-border bg-surface-raised px-2 py-1 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
            placeholder="Add tag + Enter"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tagInput.trim()) {
                e.preventDefault();
                const t = tagInput.trim();
                if (!node.data.tags.includes(t)) {
                  updateNode(node.id, { tags: [...node.data.tags, t] });
                }
                setTagInput('');
              }
            }}
          />
        </div>

        {linkHref ? (
          <Link
            href={linkHref}
            className="block rounded-lg border border-brand/30 bg-brand/10 px-2 py-1.5 text-center text-xs font-medium text-brand-bright hover:bg-brand/15"
          >
            Open linked {node.data.refType}
          </Link>
        ) : null}

        {mapId ? (
          <div className="rounded-lg border border-border p-2">
            <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-fg-subtle">
              <Sparkles className="h-3 w-3 text-brand-bright" /> AI actions
            </p>
            <div className="grid grid-cols-2 gap-1">
              <ActionBtn label="Explain" icon={Lightbulb} busy={aiBusy === 'explain-simple'} onClick={() => void runAction('explain-simple')} />
              <ActionBtn label="In depth" icon={Lightbulb} busy={aiBusy === 'explain-detail'} onClick={() => void runAction('explain-detail')} />
              <ActionBtn label="Examples" icon={Sparkles} busy={aiBusy === 'examples'} onClick={() => void runAction('examples')} />
              <ActionBtn label="Quiz" icon={HelpCircle} busy={aiBusy === 'quiz'} onClick={() => void runAction('quiz')} />
              <ActionBtn label="Flashcards" icon={Layers} busy={aiBusy === 'flashcards'} onClick={() => void runAction('flashcards')} />
              <ActionBtn label="Related" icon={Sparkles} busy={aiBusy === 'related'} onClick={() => void runAction('related')} />
            </div>
            {aiOutput ? (
              <div className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded bg-surface-raised p-2 text-xs text-fg-muted">
                {aiOutput}
              </div>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => {
            pushHistory();
            removeNodes([node.id]);
          }}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-danger/30 bg-danger/8 px-2 py-1.5 text-xs font-medium text-danger hover:bg-danger/15"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete node
        </button>
      </div>
    </aside>
  );
}

function ActionBtn({
  label,
  icon: Icon,
  busy,
  onClick,
}: {
  label: string;
  icon: typeof Sparkles;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex items-center justify-center gap-1 rounded-md border border-border bg-surface-raised px-2 py-1 text-[11px] transition-colors hover:border-brand/40 disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
      {label}
    </button>
  );
}
