'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Bot, Loader2, Plus, SendHorizonal, Sparkles, Trash2, User, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useAiStatus,
  useConversation,
  useConversations,
  useDeleteConversation,
  useSendChat,
  type AiMessage,
  type AiTier,
} from '@/hooks/use-ai';
import { cn } from '@/lib/utils';

export default function AiChatPage() {
  const { data: status } = useAiStatus();
  const { data: conversations, isLoading: loadingList } = useConversations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [tier, setTier] = useState<AiTier>('flash');

  const { data: conversation } = useConversation(selectedId);
  const send = useSendChat();
  const remove = useDeleteConversation();

  const scrollRef = useRef<HTMLDivElement>(null);

  // The user's turn, shown immediately while the model reply is in flight.
  const pending = send.isPending ? send.variables?.content : null;

  const messages: AiMessage[] = useMemo(() => {
    const base = selectedId ? (conversation?.messages ?? []) : [];
    if (pending) {
      return [
        ...base,
        { id: 'pending', role: 'USER', content: pending, createdAt: new Date().toISOString() },
      ];
    }
    return base;
  }, [selectedId, conversation?.messages, pending]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, send.isPending]);

  async function handleSend() {
    const content = draft.trim();
    if (!content || send.isPending) return;
    setDraft('');
    const result = await send.mutateAsync({
      content,
      ...(selectedId ? { conversationId: selectedId } : {}),
      tier,
    });
    // A brand-new thread: adopt the id the server just created.
    if (!selectedId) setSelectedId(result.conversationId);
  }

  const disabled = status && !status.configured;

  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] max-w-6xl gap-4">
      {/* Conversations */}
      <aside className="hidden w-64 shrink-0 flex-col md:flex">
        <Button className="w-full" onClick={() => { setSelectedId(null); setDraft(''); }}>
          <Plus className="h-4 w-4" aria-hidden />
          New chat
        </Button>

        <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {loadingList ? (
            Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-11 w-full rounded-xl" />)
          ) : conversations && conversations.length > 0 ? (
            conversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  'group flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
                  c.id === selectedId
                    ? 'border-brand bg-brand/10 text-brand-bright'
                    : 'border-transparent hover:bg-surface-raised',
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className="min-w-0 flex-1 truncate text-left"
                  title={c.title}
                >
                  {c.title}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${c.title}`}
                  onClick={() => {
                    remove.mutate(c.id);
                    if (c.id === selectedId) setSelectedId(null);
                  }}
                  className="shrink-0 text-fg-subtle opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ))
          ) : (
            <p className="px-3 py-6 text-center text-xs text-fg-subtle">No conversations yet.</p>
          )}
        </div>
      </aside>

      {/* Thread */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mb-3 flex items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Sparkles className="h-5 w-5 text-brand-bright" aria-hidden />
            AI Assistant
          </h1>
          <div className="flex items-center gap-2">
            <Link
              href="/ai/tools"
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
            >
              <Wrench className="h-3.5 w-3.5" aria-hidden />
              Study tools
            </Link>
            <div className="flex rounded-lg border border-border p-0.5 text-xs">
            {(['flash', 'pro'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                className={cn(
                  'rounded-md px-2.5 py-1 font-medium capitalize transition-colors',
                  tier === t ? 'bg-brand text-white' : 'text-fg-muted hover:text-fg',
                )}
              >
                {t}
              </button>
            ))}
            </div>
          </div>
        </header>

        {disabled ? (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-warning">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              AI is not configured
            </p>
            <p className="mt-1 text-fg-muted">
              The server needs a GEMINI_API_KEY before the assistant can respond.
            </p>
          </div>
        ) : null}

        <Card className="flex min-h-0 flex-1 flex-col p-0">
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="grid h-full place-items-center text-center">
                <div className="max-w-xs">
                  <Bot className="mx-auto h-8 w-8 text-fg-subtle" aria-hidden />
                  <p className="mt-2 text-sm font-medium">Ask anything</p>
                  <p className="mt-1 text-xs text-fg-subtle">
                    Explanations, study help, practice questions — start a conversation below.
                  </p>
                </div>
              </div>
            ) : (
              messages.map((m) => <MessageBubble key={m.id} message={m} />)
            )}

            {send.isPending ? (
              <div className="flex items-center gap-2 text-sm text-fg-subtle">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/15">
                  <Bot className="h-4 w-4 text-brand-bright" aria-hidden />
                </span>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Thinking…
              </div>
            ) : null}
          </div>

          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                rows={1}
                disabled={disabled || send.isPending}
                placeholder={disabled ? 'AI is unavailable' : 'Message the assistant…'}
                aria-label="Message the assistant"
                className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40 disabled:opacity-50"
              />
              <Button
                onClick={() => void handleSend()}
                disabled={disabled || send.isPending || !draft.trim()}
                aria-label="Send"
              >
                <SendHorizonal className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: AiMessage }) {
  const isUser = message.role === 'USER';
  return (
    <div className={cn('flex gap-2.5', isUser && 'flex-row-reverse')}>
      <span
        className={cn(
          'grid h-7 w-7 shrink-0 place-items-center rounded-full',
          isUser ? 'bg-surface-raised' : 'bg-brand/15',
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-fg-muted" aria-hidden />
        ) : (
          <Bot className="h-4 w-4 text-brand-bright" aria-hidden />
        )}
      </span>
      <div
        className={cn(
          'max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
          isUser ? 'bg-brand text-white' : 'bg-surface-raised text-fg',
        )}
      >
        {message.content}
      </div>
    </div>
  );
}
