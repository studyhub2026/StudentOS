'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  SendHorizonal,
  Sparkles,
  Trash2,
  User,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
// MessageContent is the chat-optimised Markdown renderer with tables,
// syntax highlighting, and per-block copy button. Dynamic-imported so pages
// that never load AI chat don't ship react-markdown + highlight.js
// (~90 KB gzip). Falls back to a plain-text render while loading — perfect
// during a stream because the shell is already there.
const MessageContent = dynamic(
  () => import('@/components/ai/message-content').then((m) => m.MessageContent),
  {
    ssr: false,
    loading: () => (
      <div className="whitespace-pre-wrap text-sm text-fg-muted" aria-live="polite" />
    ),
  },
);
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  createChatConversation,
  useAiStatus,
  useConversation,
  useConversations,
  useDeleteConversation,
  useSendChatStream,
  type AiMessage,
  type AiTier,
} from '@/hooks/use-ai';
import {
  AI_FILE_ACCEPT,
  deleteAiFile,
  uploadAiFile,
  validateAiFile,
} from '@/hooks/use-ai-files';
import { ContextPicker, type ContextRef } from '@/components/ai/context-picker';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/provider';

interface PendingFile {
  localId: string;
  name: string;
  size: number;
  ext: string;
  status: 'uploading' | 'ready' | 'error';
  progress: number;
  fileId?: string;
  error?: string;
}

/**
 * A piece of academic context the user attached to the next message. We keep
 * only the id + a display label client-side; the actual content is fetched
 * and bounded server-side by the existing ai-context service, so we never
 * ship note/course bodies through the browser.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function iconForExt(ext: string) {
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return ImageIcon;
  if (['xlsx', 'csv'].includes(ext)) return FileSpreadsheet;
  return FileText;
}

/** Starter prompts shown on an empty conversation to lower the blank-page cost. */
const SUGGESTIONS = [
  { icon: Sparkles, label: 'Explain a concept in simple terms', prompt: 'Explain in simple terms: ' },
  { icon: CheckCircle2, label: 'Make a practice quiz on a topic', prompt: 'Create a 5-question practice quiz about ' },
  { icon: FileText, label: 'Summarise my notes or a text', prompt: 'Summarise the key points of the following:\n\n' },
  { icon: Wrench, label: 'Plan how to study for an exam', prompt: 'Help me build a study plan for an exam on ' },
] as const;

export default function AiChatPage() {
  const t = useT();
  const { data: status } = useAiStatus();
  const { data: conversations, isLoading: loadingList } = useConversations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [tier, setTier] = useState<AiTier>('flash');
  // Persist across reloads — students usually want the same provider next
  // time. Falls back to '' = server default (env AI_CHAT_PROVIDER).
  const [provider, setProvider] = useState<'' | 'gemini' | 'deepseek'>(() => {
    if (typeof window === 'undefined') return '';
    const saved = window.localStorage.getItem('omnel:ai-provider');
    return saved === 'gemini' || saved === 'deepseek' ? saved : '';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (provider) window.localStorage.setItem('omnel:ai-provider', provider);
    else window.localStorage.removeItem('omnel:ai-provider');
  }, [provider]);

  const { data: conversation } = useConversation(selectedId);
  const send = useSendChatStream();
  const remove = useDeleteConversation();

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  // Academic context the user chose to attach to the next message.
  const [contextRefs, setContextRefs] = useState<ContextRef[]>([]);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);

  // Auto-grow the composer as the user types, capped by max-h in CSS. Runs on
  // every draft change — cheap because it only touches one element's style.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const uploading = pendingFiles.some((f) => f.status === 'uploading');
  const readyFileIds = pendingFiles.filter((f) => f.status === 'ready' && f.fileId).map((f) => f.fileId!);

  // A conversation must exist before a file can be attached to it.
  const ensureConversation = useCallback(async (): Promise<string> => {
    if (selectedId) return selectedId;
    const id = await createChatConversation();
    setSelectedId(id);
    return id;
  }, [selectedId]);

  const addFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const invalid = validateAiFile(file);
        if (invalid) {
          toast.error(invalid);
          continue;
        }
        const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const ext = file.name.toLowerCase().split('.').pop() ?? '';
        setPendingFiles((prev) => [
          ...prev,
          { localId, name: file.name, size: file.size, ext, status: 'uploading', progress: 0 },
        ]);

        try {
          const conversationId = await ensureConversation();
          const uploaded = await uploadAiFile(conversationId, file, (percent) => {
            setPendingFiles((prev) =>
              prev.map((f) => (f.localId === localId ? { ...f, progress: percent } : f)),
            );
          });
          setPendingFiles((prev) =>
            prev.map((f) =>
              f.localId === localId ? { ...f, status: 'ready', progress: 100, fileId: uploaded.id } : f,
            ),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Upload failed';
          setPendingFiles((prev) =>
            prev.map((f) => (f.localId === localId ? { ...f, status: 'error', error: message } : f)),
          );
          toast.error(message);
        }
      }
    },
    [ensureConversation],
  );

  const removeFile = useCallback((localId: string) => {
    setPendingFiles((prev) => {
      const target = prev.find((f) => f.localId === localId);
      if (target?.fileId) void deleteAiFile(target.fileId).catch(() => undefined);
      return prev.filter((f) => f.localId !== localId);
    });
  }, []);

  // With streaming, the hook writes the optimistic user turn + assistant
  // placeholder straight into the React Query cache — the conversation
  // detail already contains everything the UI needs to render, so we don't
  // synthesise a separate `pending` bubble here.
  const messages: AiMessage[] = useMemo(
    () => (selectedId ? (conversation?.messages ?? []) : []),
    [selectedId, conversation?.messages],
  );

  // Virtualisation: very long threads render only the most recent window so
  // the DOM (and each MessageContent Markdown render) stays cheap. The user
  // can reveal older messages in chunks. Reset the window when switching
  // conversations.
  const WINDOW = 40;
  const [visibleCount, setVisibleCount] = useState(WINDOW);
  useEffect(() => {
    setVisibleCount(WINDOW);
  }, [selectedId]);
  const hiddenCount = Math.max(0, messages.length - visibleCount);
  const visibleMessages = hiddenCount > 0 ? messages.slice(hiddenCount) : messages;

  // "Thinking…" is only shown while the streaming placeholder is still
  // empty. As soon as the first delta arrives the assistant bubble fills
  // in and the indicator disappears.
  const lastMessage = messages[messages.length - 1];
  const showThinking =
    send.isStreaming && lastMessage?.role === 'MODEL' && !lastMessage.content;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, lastMessage?.content, send.isStreaming]);

  // Once a reply lands (the message list grows), the staged files have been
  // sent and persisted to the conversation — clear the composer tray.
  const messageCount = conversation?.messages.length ?? 0;
  useEffect(() => {
    setPendingFiles([]);
  }, [messageCount]);

  async function handleSend() {
    if (send.isStreaming || uploading) return;
    // A file-only turn gets a sensible default prompt.
    const content =
      draft.trim() || (readyFileIds.length > 0 ? 'Please review the attached file(s).' : '');
    if (!content) return;

    setDraft('');
    const fileIds = readyFileIds;
    setPendingFiles([]);
    const refs = contextRefs.map((r) => ({ type: r.type, id: r.id }));
    setContextRefs([]);

    const result = await send.send({
      content,
      ...(selectedId ? { conversationId: selectedId } : {}),
      ...(fileIds.length > 0 ? { fileIds } : {}),
      tier,
      ...(provider ? { provider } : {}),
      ...(refs.length > 0 ? { contextRefs: refs } : {}),
    });
    // A brand-new thread: adopt the id the server just created (arrives in
    // the meta frame, so it's already in the result by the time we get here).
    if (!selectedId && result?.conversationId) setSelectedId(result.conversationId);
  }

  const disabled = status && !status.configured;

  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] max-w-6xl gap-4">
      {/* Conversations */}
      <aside className="hidden w-64 shrink-0 flex-col md:flex">
        <Button className="w-full" onClick={() => { setSelectedId(null); setDraft(''); setPendingFiles([]); }}>
          <Plus className="h-4 w-4" aria-hidden />
          {t('ai.newChat')}
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
                  onClick={() => { setSelectedId(c.id); setPendingFiles([]); }}
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
      <div
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (disabled) return;
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length > 0) void addFiles(files);
        }}
      >
        <AnimatePresence>
          {dragging ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-brand bg-surface/85 backdrop-blur-sm"
            >
              <div className="text-center">
                <Paperclip className="mx-auto h-8 w-8 text-brand-bright" aria-hidden />
                <p className="mt-2 text-sm font-medium">Drop files to attach</p>
                <p className="text-xs text-fg-subtle">PDF, DOCX, PPTX, XLSX, CSV, TXT, MD, images · up to 25 MB</p>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <header className="mb-3 flex items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Sparkles className="h-5 w-5 text-brand-bright" aria-hidden />
            {t('ai.title')}
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
            {/* Provider picker — 'Auto' respects AI_CHAT_PROVIDER on the
                server; the two explicit options let the student force a
                specific brain. If the chosen provider isn't configured on
                this deployment the server falls back to Gemini and the UI
                stays working (a small chip on the assistant bubble notes
                the fallback). */}
            <label className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs">
              <span className="text-fg-subtle">Model:</span>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as '' | 'gemini' | 'deepseek')}
                className="cursor-pointer bg-transparent text-fg-muted outline-none hover:text-fg"
              >
                <option value="">Auto</option>
                <option value="gemini">Gemini</option>
                <option value="deepseek">DeepSeek</option>
              </select>
            </label>
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
                <div className="w-full max-w-md">
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand/20 to-accent/15">
                    <Bot className="h-6 w-6 text-brand-bright" aria-hidden />
                  </span>
                  <p className="mt-3 text-sm font-medium">Ask anything</p>
                  <p className="mt-1 text-xs text-fg-subtle">
                    Explanations, study help, practice questions — or attach a file to discuss it.
                  </p>
                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s.prompt}
                        type="button"
                        disabled={disabled}
                        onClick={() => setDraft(s.prompt)}
                        className="group flex items-start gap-2.5 rounded-xl border border-border bg-surface-raised/50 p-3 text-left transition-colors hover:border-brand/40 hover:bg-brand/8 disabled:opacity-50"
                      >
                        <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-bright" aria-hidden />
                        <span className="text-xs text-fg-muted group-hover:text-fg">{s.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                {hiddenCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setVisibleCount((c) => c + WINDOW)}
                    className="mx-auto block rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:border-brand/40 hover:text-fg"
                  >
                    Show {Math.min(WINDOW, hiddenCount)} earlier message{hiddenCount === 1 ? '' : 's'}
                  </button>
                ) : null}
                {visibleMessages.map((m) => (
                  <MessageBubble key={m.id} message={m} />
                ))}
              </>
            )}

            {showThinking ? (
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
            <AnimatePresence initial={false}>
              {pendingFiles.length > 0 ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-2 flex flex-wrap gap-2 overflow-hidden"
                >
                  {pendingFiles.map((file) => (
                    <FileChip key={file.localId} file={file} onRemove={() => removeFile(file.localId)} />
                  ))}
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* Attached academic-context chips */}
            {contextRefs.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {contextRefs.map((r) => (
                  <span
                    key={`${r.type}-${r.id}`}
                    className="flex items-center gap-1 rounded-md border border-brand/30 bg-brand/10 px-2 py-0.5 text-xs text-brand-bright"
                  >
                    <span className="text-[10px] uppercase text-fg-subtle">{r.type}</span>
                    <span className="max-w-[140px] truncate">{r.label}</span>
                    <button
                      type="button"
                      onClick={() => setContextRefs((prev) => prev.filter((x) => !(x.type === r.type && x.id === r.id)))}
                      className="text-fg-subtle hover:text-danger"
                      aria-label={`Remove ${r.label}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={AI_FILE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) void addFiles(files);
                  e.target.value = '';
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Attach files"
                title="Attach files (PDF, DOCX, images…)"
                disabled={disabled}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-4 w-4" aria-hidden />
              </Button>
              {/* Context selector */}
              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Attach context"
                  title="Attach a note, subject or document as context"
                  disabled={disabled}
                  onClick={() => setContextPickerOpen((v) => !v)}
                  className={cn(contextRefs.length > 0 && 'text-brand-bright')}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </Button>
                {contextPickerOpen ? (
                  <ContextPicker
                    selected={contextRefs}
                    onToggle={(ref) =>
                      setContextRefs((prev) =>
                        prev.some((x) => x.type === ref.type && x.id === ref.id)
                          ? prev.filter((x) => !(x.type === ref.type && x.id === ref.id))
                          : [...prev, ref],
                      )
                    }
                    onClose={() => setContextPickerOpen(false)}
                  />
                ) : null}
              </div>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter or Ctrl/Cmd+Enter sends; Shift+Enter inserts a newline.
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData.files ?? []);
                  if (files.length > 0) {
                    e.preventDefault();
                    void addFiles(files);
                  }
                }}
                rows={1}
                disabled={disabled || send.isStreaming}
                placeholder={disabled ? 'AI is unavailable' : 'Message the assistant, or attach a file…'}
                aria-label="Message the assistant"
                className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40 disabled:opacity-50"
              />
              {send.isStreaming ? (
                <Button
                  onClick={() => send.stop()}
                  variant="ghost"
                  aria-label="Stop generating"
                  title="Stop generating"
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              ) : (
                <Button
                  onClick={() => void handleSend()}
                  disabled={
                    disabled || uploading || (!draft.trim() && readyFileIds.length === 0)
                  }
                  aria-label="Send"
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <SendHorizonal className="h-4 w-4" aria-hidden />
                  )}
                </Button>
              )}
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
          'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
          isUser ? 'whitespace-pre-wrap bg-brand text-white' : 'bg-surface-raised text-fg',
        )}
      >
        {isUser ? (
          message.content
        ) : (
          <MessageContent content={message.content} />
        )}
      </div>
    </div>
  );
}

function FileChip({ file, onRemove }: { file: PendingFile; onRemove: () => void }) {
  const Icon = iconForExt(file.ext);
  const isError = file.status === 'error';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={cn(
        'relative flex items-center gap-2 overflow-hidden rounded-xl border px-2.5 py-1.5 text-xs',
        isError ? 'border-danger/40 bg-danger/8' : 'border-border bg-surface-raised',
      )}
    >
      <span
        className={cn(
          'grid h-7 w-7 shrink-0 place-items-center rounded-lg',
          isError ? 'bg-danger/12 text-danger' : 'bg-brand/12 text-brand-bright',
        )}
      >
        {file.status === 'uploading' ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Icon className="h-4 w-4" aria-hidden />
        )}
      </span>

      <div className="min-w-0">
        <p className="max-w-[10rem] truncate font-medium">{file.name}</p>
        <p className={cn('truncate', isError ? 'text-danger' : 'text-fg-subtle')}>
          {file.status === 'uploading'
            ? `Uploading… ${file.progress}%`
            : isError
              ? (file.error ?? 'Upload failed')
              : `${file.ext.toUpperCase()} · ${formatBytes(file.size)}`}
        </p>
      </div>

      {file.status === 'ready' ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
      ) : null}

      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
        className="shrink-0 rounded p-0.5 text-fg-subtle transition-colors hover:text-danger"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>

      {file.status === 'uploading' ? (
        <span
          className="absolute bottom-0 left-0 h-0.5 bg-brand transition-all duration-200"
          style={{ width: `${file.progress}%` }}
          aria-hidden
        />
      ) : null}
    </motion.div>
  );
}
