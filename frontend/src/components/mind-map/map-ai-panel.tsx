'use client';

import { useState } from 'react';
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  Loader2,
  MessagesSquare,
  Send,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';
import { useMindMapEditor } from '@/stores/mind-map-editor-store';

type MapAction = 'summarise-map' | 'study-guide' | 'analyse';

interface MapActionMeta {
  key: MapAction;
  label: string;
  icon: typeof Sparkles;
  hint: string;
}

const MAP_ACTIONS: MapActionMeta[] = [
  { key: 'summarise-map', label: 'Summarise map', icon: BookOpen, hint: 'Overview of the whole map.' },
  { key: 'study-guide', label: 'Study guide', icon: ClipboardList, hint: 'Structured plan with practice questions.' },
  { key: 'analyse', label: 'Analyse map', icon: BarChart3, hint: 'Findings only — no auto-changes.' },
];

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Slide-out panel that hosts every map-level AI feature: whole-map
 * summarise/study-guide/analyse, branch-summarise for the current selection,
 * and Ask-this-Map chat scoped to the map (+ selected branch when set).
 *
 * Every action reads plain text from the server; nothing here modifies the
 * map. The student decides what to keep — the point of the panel is a
 * read-only sidecar that never surprises the user by editing the map.
 */
export function MapAiPanel({
  mapId,
  open,
  onClose,
}: {
  mapId: string;
  open: boolean;
  onClose: () => void;
}) {
  const selectedNodeId = useMindMapEditor((s) => s.selectedNodeId);
  const selectedTitle = useMindMapEditor(
    (s) => s.nodes.find((n) => n.id === selectedNodeId)?.data.title ?? null,
  );

  const [tab, setTab] = useState<'actions' | 'chat'>('actions');
  const [busy, setBusy] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [outputTitle, setOutputTitle] = useState<string | null>(null);

  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  if (!open) return null;

  async function runMap(action: MapAction, label: string) {
    setBusy(action);
    setOutput(null);
    setOutputTitle(label);
    try {
      const { data } = await apiClient.post<ApiEnvelope<{ text: string }>>(
        `/mind-maps/${mapId}/actions`,
        { action },
      );
      setOutput(data.data.text);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function runBranch() {
    if (!selectedNodeId) {
      toast.info('Select a node first to summarise its branch');
      return;
    }
    setBusy('summarise-branch');
    setOutput(null);
    setOutputTitle(`Branch summary — ${selectedTitle ?? 'selected node'}`);
    try {
      const { data } = await apiClient.post<ApiEnvelope<{ text: string }>>(
        `/mind-maps/${mapId}/actions`,
        { action: 'summarise-branch', nodeId: selectedNodeId },
      );
      setOutput(data.data.text);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function sendChat() {
    const q = chatDraft.trim();
    if (!q) return;
    setChatDraft('');
    setChat((prev) => [...prev, { role: 'user', text: q }]);
    setChatBusy(true);
    try {
      const { data } = await apiClient.post<ApiEnvelope<{ text: string }>>(
        `/mind-maps/${mapId}/chat`,
        {
          question: q,
          ...(selectedNodeId ? { selectedNodeId } : {}),
        },
      );
      setChat((prev) => [...prev, { role: 'assistant', text: data.data.text }]);
    } catch (err) {
      setChat((prev) => [...prev, { role: 'assistant', text: `Error: ${apiErrorMessage(err)}` }]);
    } finally {
      setChatBusy(false);
    }
  }

  return (
    <aside className="fixed right-0 top-14 z-20 flex h-[calc(100vh-3.5rem)] w-full max-w-[24rem] flex-col border-l border-border bg-[var(--color-surface)] sm:w-96">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-brand-bright" /> Mind Map AI
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-fg-subtle hover:text-fg"
          aria-label="Close AI panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-1 border-b border-border p-2">
        {(
          [
            { k: 'actions', label: 'Actions', icon: Wand2 },
            { k: 'chat', label: 'Ask this Map', icon: MessagesSquare },
          ] as const
        ).map(({ k, label, icon: Icon }) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              tab === k ? 'bg-brand/12 text-brand-bright' : 'text-fg-muted hover:text-fg',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'actions' ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-subtle">
              Whole map
            </p>
            <div className="space-y-1">
              {MAP_ACTIONS.map(({ key, label, icon: Icon, hint }) => (
                <button
                  key={key}
                  type="button"
                  disabled={!!busy}
                  onClick={() => runMap(key, label)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg border border-border p-2 text-left text-xs transition-colors',
                    'hover:border-brand/40 hover:bg-surface-raised disabled:opacity-60',
                  )}
                >
                  {busy === key ? (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-brand-bright" />
                  ) : (
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-bright" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{label}</span>
                    <span className="mt-0.5 block text-fg-subtle">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-subtle">
              Current selection
            </p>
            <button
              type="button"
              disabled={!!busy || !selectedNodeId}
              onClick={runBranch}
              className={cn(
                'flex w-full items-start gap-2 rounded-lg border border-border p-2 text-left text-xs transition-colors',
                'hover:border-brand/40 hover:bg-surface-raised disabled:opacity-60',
              )}
            >
              {busy === 'summarise-branch' ? (
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-brand-bright" />
              ) : (
                <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-bright" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Summarise this branch</span>
                <span className="mt-0.5 block text-fg-subtle">
                  {selectedTitle ? `From "${selectedTitle}" and its descendants` : 'Select a node first'}
                </span>
              </span>
            </button>
          </div>

          {output ? (
            <div className="rounded-lg border border-border bg-surface-raised p-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-brand-bright">
                {outputTitle}
              </p>
              <p className="whitespace-pre-wrap text-xs text-fg">{output}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {chat.length === 0 ? (
              <p className="mt-4 text-center text-xs text-fg-subtle">
                Ask anything about this map. Try<br />
                <em>&ldquo;What should I study first?&rdquo;</em><br />
                <em>&ldquo;Which topics are prerequisites?&rdquo;</em><br />
                <em>&ldquo;What am I missing?&rdquo;</em>
              </p>
            ) : (
              chat.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    'max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs',
                    m.role === 'user'
                      ? 'ml-auto bg-brand/15 text-brand-bright'
                      : 'bg-surface-raised text-fg',
                  )}
                >
                  <span className="whitespace-pre-wrap">{m.text}</span>
                </div>
              ))
            )}
            {chatBusy ? (
              <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
                <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
              </div>
            ) : null}
          </div>
          <div className="border-t border-border p-2">
            {selectedNodeId ? (
              <p className="mb-1 text-[10px] text-fg-subtle">
                Scoped to selected node: <span className="text-fg-muted">{selectedTitle}</span>
              </p>
            ) : null}
            <div className="flex gap-1">
              <input
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendChat();
                  }
                }}
                placeholder="Ask this map…"
                disabled={chatBusy}
                className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
              />
              <Button size="sm" onClick={sendChat} disabled={chatBusy || !chatDraft.trim()}>
                <Send className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
