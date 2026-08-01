'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlignLeft,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ClipboardCopy,
  FileText,
  Languages,
  Layers,
  Loader2,
  MessageSquare,
  Minimize2,
  PenLine,
  Sparkles,
  Type,
  Wand2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

interface ActionDef {
  id: string;
  label: string;
  icon: React.ElementType;
  needsExtra?: boolean;
  extraPlaceholder?: string;
}

const ACTIONS: ActionDef[] = [
  { id: 'explain', label: 'Explain', icon: Bot },
  { id: 'summarize', label: 'Summarize', icon: AlignLeft },
  { id: 'rewrite', label: 'Rewrite', icon: PenLine },
  { id: 'shorten', label: 'Shorten', icon: Minimize2 },
  { id: 'expand', label: 'Expand', icon: Type },
  { id: 'improve', label: 'Improve', icon: Wand2 },
  { id: 'fix_grammar', label: 'Fix Grammar', icon: Check },
  { id: 'translate', label: 'Translate', icon: Languages, needsExtra: true, extraPlaceholder: 'Target language (e.g. Spanish)' },
  { id: 'generate_quiz', label: 'Quiz', icon: FileText },
  { id: 'generate_flashcards', label: 'Flashcards', icon: Layers },
  { id: 'generate_notes', label: 'Notes', icon: BookOpen },
  { id: 'ask_ai', label: 'Ask AI', icon: MessageSquare, needsExtra: true, extraPlaceholder: 'Your question...' },
];

interface ActionResult {
  result: string;
  model: string;
  tokens: number;
}

export function AiToolbar() {
  const [selection, setSelection] = useState<{ text: string; rect: DOMRect } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [extraInput, setExtraInput] = useState<{ action: ActionDef; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const handleSelection = useCallback(() => {
    // Text selected inside a <textarea> or <input> is not exposed through the
    // document Selection API, so those fields are handled separately via
    // selectionStart/End. This makes the toolbar work in the note editor,
    // assignment descriptions, chat composers and every other form field.
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === 'TEXTAREA' ||
        (active.tagName === 'INPUT' && (active as HTMLInputElement).type === 'text'))
    ) {
      const field = active as HTMLTextAreaElement | HTMLInputElement;
      const start = field.selectionStart ?? 0;
      const end = field.selectionEnd ?? 0;
      const text = field.value.slice(start, end).trim();
      if (text.length >= 3 && text.length <= 10000) {
        const rect = field.getBoundingClientRect();
        setSelection({ text, rect });
        setExpanded(false);
        setResult(null);
        setExtraInput(null);
        return;
      }
    }

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 3 || text.length > 10000) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setSelection({ text, rect });
    setExpanded(false);
    setResult(null);
    setExtraInput(null);
  }, []);

  useEffect(() => {
    const onMouseUp = () => setTimeout(handleSelection, 10);
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey) setTimeout(handleSelection, 10);
    };
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, [handleSelection]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (toolbarRef.current?.contains(e.target as Node)) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setSelection(null);
        setResult(null);
        setExtraInput(null);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const runAction = useCallback(
    async (action: ActionDef, extra?: string) => {
      if (!selection) return;
      if (action.needsExtra && !extra) {
        setExtraInput({ action, text: '' });
        return;
      }
      setLoading(true);
      setResult(null);
      setExtraInput(null);
      try {
        const { data } = await apiClient.post<ApiEnvelope<ActionResult>>('/ai/actions', {
          action: action.id,
          text: selection.text,
          extra,
        });
        setResult(data.data.result);
      } catch {
        setResult('Failed to process. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [selection],
  );

  const copyResult = useCallback(async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [result]);

  if (!selection) return null;

  const top = selection.rect.top + window.scrollY - 8;
  const left = Math.max(
    8,
    Math.min(
      selection.rect.left + selection.rect.width / 2 - 200,
      window.innerWidth - 416,
    ),
  );

  const visibleActions = expanded ? ACTIONS : ACTIONS.slice(0, 6);

  return (
    <AnimatePresence>
      <motion.div
        ref={toolbarRef}
        className="fixed z-[90] w-[400px]"
        style={{ top, left, transform: 'translateY(-100%)' }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.15 }}
      >
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          {/* Action buttons */}
          <div className="flex flex-wrap gap-1 p-2">
            {visibleActions.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={loading}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
                  'text-fg-muted hover:bg-brand/12 hover:text-brand-bright disabled:opacity-50',
                )}
                onClick={() => void runAction(action)}
              >
                <action.icon className="h-3.5 w-3.5" />
                {action.label}
              </button>
            ))}
            {!expanded ? (
              <button
                type="button"
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-fg-subtle hover:bg-surface-raised"
                onClick={() => setExpanded(true)}
              >
                <ChevronDown className="h-3 w-3" />
                More
              </button>
            ) : null}
          </div>

          {/* Extra input (translate language, ask question) */}
          {extraInput ? (
            <div className="border-t border-border p-2">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void runAction(extraInput.action, extraInput.text);
                }}
              >
                <input
                  type="text"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:border-brand focus:outline-none"
                  placeholder={extraInput.action.extraPlaceholder}
                  value={extraInput.text}
                  onChange={(e) => setExtraInput({ ...extraInput, text: e.target.value })}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!extraInput.text.trim()}
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-bright disabled:opacity-50"
                >
                  Go
                </button>
              </form>
            </div>
          ) : null}

          {/* Loading */}
          {loading ? (
            <div className="flex items-center gap-2 border-t border-border px-3 py-3 text-xs text-fg-subtle">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Processing with AI...
            </div>
          ) : null}

          {/* Result */}
          {result ? (
            <div className="border-t border-border">
              <div className="max-h-64 overflow-y-auto p-3">
                <pre className="whitespace-pre-wrap text-xs leading-relaxed text-fg">
                  {result}
                </pre>
              </div>
              <div className="flex items-center gap-2 border-t border-border px-3 py-2">
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
                  onClick={() => void copyResult()}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-teal" />
                  ) : (
                    <ClipboardCopy className="h-3.5 w-3.5" />
                  )}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
                  onClick={() => { setResult(null); setSelection(null); }}
                >
                  <X className="h-3.5 w-3.5" />
                  Close
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
