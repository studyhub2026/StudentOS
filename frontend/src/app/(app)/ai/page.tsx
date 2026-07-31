'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
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
import { MarkdownPreview } from '@/components/notes/markdown-preview';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  createChatConversation,
  useAiStatus,
  useConversation,
  useConversations,
  useDeleteConversation,
  useSendChat,
  type AiMessage,
  type AiTier,
} from '@/hooks/use-ai';
import {
  AI_FILE_ACCEPT,
  deleteAiFile,
  uploadAiFile,
  validateAiFile,
} from '@/hooks/use-ai-files';
import { cn } from '@/lib/utils';

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);

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

  // Once a reply lands (the message list grows), the staged files have been
  // sent and persisted to the conversation — clear the composer tray.
  const messageCount = conversation?.messages.length ?? 0;
  useEffect(() => {
    setPendingFiles([]);
  }, [messageCount]);

  async function handleSend() {
    if (send.isPending || uploading) return;
    // A file-only turn gets a sensible default prompt.
    const content = draft.trim() || (readyFileIds.length > 0 ? 'Please review the attached file(s).' : '');
    if (!content) return;

    setDraft('');
    const fileIds = readyFileIds;
    setPendingFiles([]);

    const result = await send.mutateAsync({
      content,
      ...(selectedId ? { conversationId: selectedId } : {}),
      ...(fileIds.length > 0 ? { fileIds } : {}),
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
        <Button className="w-full" onClick={() => { setSelectedId(null); setDraft(''); setPendingFiles([]); }}>
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
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
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
                disabled={disabled || send.isPending}
                placeholder={disabled ? 'AI is unavailable' : 'Message the assistant, or attach a file…'}
                aria-label="Message the assistant"
                className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40 disabled:opacity-50"
              />
              <Button
                onClick={() => void handleSend()}
                disabled={disabled || send.isPending || uploading || (!draft.trim() && readyFileIds.length === 0)}
                aria-label="Send"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <SendHorizonal className="h-4 w-4" aria-hidden />
                )}
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
          'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
          isUser ? 'whitespace-pre-wrap bg-brand text-white' : 'bg-surface-raised text-fg',
        )}
      >
        {isUser ? (
          message.content
        ) : (
          <MarkdownPreview content={message.content} />
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
