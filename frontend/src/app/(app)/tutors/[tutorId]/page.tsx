'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Copy,
  FileText,
  Gauge,
  Layers,
  Lightbulb,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  SendHorizonal,
  Sparkles,
  SquarePen,
  StopCircle,
  Target,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { MarkdownPreview } from '@/components/notes/markdown-preview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  createTutorConversation,
  useDeleteTutorConversation,
  useGenerateFlashcards,
  useGenerateInsights,
  useGenerateQuiz,
  useSetRecommendationDone,
  useSubmitQuiz,
  useTutor,
  useTutorConversation,
  useUpdateTutor,
  useUpdateTutorConversation,
  useUpdateTutorMessage,
  tutorKeys,
  type Difficulty,
  type FlashcardData,
  type QuizData,
  type TutorMessage,
} from '@/hooks/use-tutors';
import {
  AI_FILE_ACCEPT,
  deleteTutorFile,
  uploadTutorFile,
  validateAiFile,
} from '@/hooks/use-tutor-files';
import { postSse } from '@/lib/sse';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'BEGINNER', label: 'Beginner' },
  { value: 'INTERMEDIATE', label: 'Intermediate' },
  { value: 'ADVANCED', label: 'Advanced' },
  { value: 'ADAPTIVE', label: 'Adaptive' },
];

// Each quick action prefills the composer with an editable scaffold ending in a
// colon — the student just types the topic and sends. No blocking dialogs.
const QUICK_ACTIONS: { key: string; label: string; icon: typeof Lightbulb; scaffold: string }[] = [
  { key: 'explain', label: 'Explain a concept', icon: Lightbulb, scaffold: 'Explain this concept to me, with a concrete example: ' },
  { key: 'example', label: 'Worked example', icon: SquarePen, scaffold: 'Give me a worked example, solved step by step, for: ' },
  { key: 'practice', label: 'Practice questions', icon: Target, scaffold: 'Give me 3 practice questions (easier → harder), without answers yet, on: ' },
  { key: 'summary', label: 'Revision notes', icon: BookOpen, scaffold: 'Write concise revision notes on: ' },
  { key: 'studyPlan', label: 'Study plan', icon: Gauge, scaffold: 'Recommend a step-by-step study plan for: ' },
];

interface PendingFile {
  localId: string;
  name: string;
  status: 'uploading' | 'ready' | 'error';
  progress: number;
  fileId?: string;
  error?: string;
}

export default function TutorChatPage() {
  const params = useParams<{ tutorId: string }>();
  const tutorId = params.tutorId;
  const queryClient = useQueryClient();

  const { data: detail, isLoading } = useTutor(tutorId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [convSearch, setConvSearch] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);

  const { data: conversation } = useTutorConversation(tutorId, selectedId);
  const deleteConv = useDeleteTutorConversation(tutorId);
  const updateConv = useUpdateTutorConversation(tutorId);
  const updateMessage = useUpdateTutorMessage(tutorId, selectedId);
  const updateTutor = useUpdateTutor(tutorId);
  const genInsights = useGenerateInsights(tutorId);
  const genQuiz = useGenerateQuiz(tutorId);
  const genFlashcards = useGenerateFlashcards(tutorId);

  // Streaming state.
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);

  // Consume any text handed off by the AI Toolbar's "Ask AI Tutor" action.
  // Runs once per mount and clears the handoff so re-navigating doesn't
  // resurrect stale selections.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem('studentos.aiToolbarPrefill');
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && 'text' in parsed) {
        const text = String((parsed as { text: unknown }).text ?? '').trim();
        if (text) {
          setDraft(text);
          requestAnimationFrame(() => composerRef.current?.focus());
        }
      }
      sessionStorage.removeItem('studentos.aiToolbarPrefill');
    } catch {
      /* malformed handoff — drop it */
    }
  }, []);

  const tutor = detail?.tutor;
  const difficulty = tutor?.difficulty ?? 'ADAPTIVE';

  const conversations = useMemo(() => {
    let list = detail?.conversations ?? [];
    const q = convSearch.trim().toLowerCase();
    if (q) list = list.filter((c) => c.title.toLowerCase().includes(q));
    return list;
  }, [detail?.conversations, convSearch]);

  const messages: TutorMessage[] = useMemo(() => {
    let base = selectedId ? (conversation?.messages ?? []) : [];
    if (pinnedOnly) base = base.filter((m) => m.pinned);
    return base;
  }, [selectedId, conversation?.messages, pinnedOnly]);

  const uploading = pendingFiles.some((f) => f.status === 'uploading');
  const busy = streaming || genQuiz.isPending || genFlashcards.isPending;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, streamText, pendingUser]);

  // --- File attach ----------------------------------------------------------

  const ensureConversation = useCallback(async (): Promise<string> => {
    if (selectedId) return selectedId;
    const id = await createTutorConversation(tutorId);
    setSelectedId(id);
    void queryClient.invalidateQueries({ queryKey: tutorKeys.detail(tutorId) });
    return id;
  }, [selectedId, tutorId, queryClient]);

  const addFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const invalid = validateAiFile(file);
        if (invalid) {
          toast.error(invalid);
          continue;
        }
        const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setPendingFiles((prev) => [...prev, { localId, name: file.name, status: 'uploading', progress: 0 }]);
        try {
          const conversationId = await ensureConversation();
          const uploaded = await uploadTutorFile(tutorId, conversationId, file, (percent) => {
            setPendingFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, progress: percent } : f)));
          });
          setPendingFiles((prev) =>
            prev.map((f) => (f.localId === localId ? { ...f, status: 'ready', progress: 100, fileId: uploaded.id } : f)),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Upload failed';
          setPendingFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, status: 'error', error: message } : f)));
          toast.error(message);
        }
      }
    },
    [ensureConversation, tutorId],
  );

  const removeFile = useCallback(
    (localId: string) => {
      setPendingFiles((prev) => {
        const target = prev.find((f) => f.localId === localId);
        if (target?.fileId) void deleteTutorFile(tutorId, target.fileId).catch(() => undefined);
        return prev.filter((f) => f.localId !== localId);
      });
    },
    [tutorId],
  );

  // --- Send / stream --------------------------------------------------------

  const runStream = useCallback(
    async (content: string) => {
      if (busy) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      setStreamText('');
      setPendingUser(content);
      setPendingFiles([]);

      let convId = selectedId;
      try {
        for await (const msg of postSse(
          `/api/v1/ai/tutors/${tutorId}/chat/stream`,
          { content, ...(selectedId ? { conversationId: selectedId } : {}), difficulty },
          controller.signal,
        )) {
          if (msg.event === 'meta') {
            const data = JSON.parse(msg.data) as { conversationId: string };
            convId = data.conversationId;
            if (!selectedId) setSelectedId(data.conversationId);
          } else if (msg.event === 'delta') {
            setStreamText((prev) => prev + JSON.parse(msg.data));
          } else if (msg.event === 'error') {
            const data = JSON.parse(msg.data) as { message: string };
            toast.error(data.message);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          toast.error(error instanceof Error ? error.message : 'Generation failed');
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
        setStreamText('');
        setPendingUser(null);
        if (convId) {
          await queryClient.invalidateQueries({ queryKey: tutorKeys.conversation(tutorId, convId) });
        }
        void queryClient.invalidateQueries({ queryKey: tutorKeys.detail(tutorId) });
      }
    },
    [busy, selectedId, tutorId, difficulty, queryClient],
  );

  async function handleSend() {
    if (busy || uploading) return;
    const content = draft.trim();
    if (!content) return;
    setDraft('');
    await runStream(content);
  }

  function stop() {
    abortRef.current?.abort();
  }

  function regenerate() {
    const lastUser = [...messages].reverse().find((m) => m.role === 'USER');
    if (lastUser) void runStream(lastUser.content);
  }

  function runQuickAction(scaffold: string) {
    setDraft(scaffold);
    // Focus the composer and drop the cursor at the end so the student types the topic.
    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = el.value.length;
      }
    });
  }

  async function makeQuiz() {
    if (busy) return;
    const conversationId = await ensureConversation();
    const quiz = await genQuiz.mutateAsync({ conversationId });
    if (quiz.messageId) {
      await queryClient.invalidateQueries({ queryKey: tutorKeys.conversation(tutorId, conversationId) });
    }
  }

  async function makeFlashcards() {
    if (busy) return;
    const conversationId = await ensureConversation();
    const cards = await genFlashcards.mutateAsync({ conversationId });
    if (cards.messageId) {
      await queryClient.invalidateQueries({ queryKey: tutorKeys.conversation(tutorId, conversationId) });
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <Skeleton className="h-[70vh] w-full rounded-2xl" />
      </div>
    );
  }

  if (!tutor) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-sm text-fg-muted">This tutor could not be found.</p>
        <Link href="/tutors" className="mt-3 inline-flex text-sm text-brand-bright hover:underline">
          Back to tutors
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] max-w-7xl flex-col">
      {/* Header */}
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/tutors"
            aria-label="Back to tutors"
            className="grid h-9 w-9 place-items-center rounded-xl border border-border text-fg-muted transition-colors hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
          <span
            className="grid h-10 w-10 place-items-center rounded-xl text-xl"
            style={{ backgroundColor: `${tutor.accent}22` }}
          >
            {tutor.emoji}
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{tutor.subject} Tutor</h1>
            <p className="text-xs text-fg-subtle">Remembers only your {tutor.subject.toLowerCase()} work.</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5 text-xs">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => updateTutor.mutate({ difficulty: d.value })}
                className={cn(
                  'rounded-md px-2 py-1 font-medium transition-colors',
                  difficulty === d.value ? 'bg-brand text-white' : 'text-fg-muted hover:text-fg',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Conversation rail */}
        <aside className="hidden w-60 shrink-0 flex-col md:flex">
          <Button className="w-full" onClick={() => { setSelectedId(null); setDraft(''); setPendingFiles([]); }}>
            <MessageSquarePlus className="h-4 w-4" aria-hidden />
            New conversation
          </Button>

          <div className="relative mt-3">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <input
              value={convSearch}
              onChange={(e) => setConvSearch(e.target.value)}
              placeholder="Search…"
              aria-label="Search conversations"
              className="w-full rounded-lg border border-border bg-surface-raised py-1.5 pl-8 pr-2 text-xs outline-none focus:border-brand"
            />
          </div>

          <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-fg-subtle">No conversations yet.</p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'group flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-sm transition-colors',
                    c.id === selectedId ? 'border-brand bg-brand/10 text-brand-bright' : 'border-transparent hover:bg-surface-raised',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => { setSelectedId(c.id); setPinnedOnly(false); }}
                    className="min-w-0 flex-1 truncate text-left"
                    title={c.title}
                  >
                    {c.pinned ? <Pin className="mr-1 inline h-3 w-3 text-brand-bright" aria-hidden /> : null}
                    {c.title}
                  </button>
                  <button
                    type="button"
                    aria-label={c.pinned ? 'Unpin' : 'Pin'}
                    onClick={() => updateConv.mutate({ id: c.id, pinned: !c.pinned })}
                    className="shrink-0 text-fg-subtle opacity-0 transition-opacity hover:text-brand-bright focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    {c.pinned ? <PinOff className="h-3.5 w-3.5" aria-hidden /> : <Pin className="h-3.5 w-3.5" aria-hidden />}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${c.title}`}
                    onClick={() => { deleteConv.mutate(c.id); if (c.id === selectedId) setSelectedId(null); }}
                    className="shrink-0 text-fg-subtle opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Thread */}
        <div
          className="relative flex min-w-0 flex-1 flex-col"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
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
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <Card className="flex min-h-0 flex-1 flex-col p-0">
            {/* Thread toolbar */}
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    onClick={() => runQuickAction(action.scaffold)}
                    disabled={busy}
                    className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-50"
                  >
                    <action.icon className="h-3 w-3" aria-hidden />
                    {action.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={makeQuiz}
                  disabled={busy}
                  className="flex items-center gap-1 rounded-lg border border-brand/30 bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand-bright transition-colors hover:bg-brand/20 disabled:opacity-50"
                >
                  {genQuiz.isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Wand2 className="h-3 w-3" aria-hidden />}
                  Quiz
                </button>
                <button
                  type="button"
                  onClick={makeFlashcards}
                  disabled={busy}
                  className="flex items-center gap-1 rounded-lg border border-teal/30 bg-teal/10 px-2 py-1 text-[11px] font-medium text-teal transition-colors hover:bg-teal/20 disabled:opacity-50"
                >
                  {genFlashcards.isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Layers className="h-3 w-3" aria-hidden />}
                  Flashcards
                </button>
              </div>
              <button
                type="button"
                onClick={() => setPinnedOnly((v) => !v)}
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition-colors',
                  pinnedOnly ? 'border-brand bg-brand/10 text-brand-bright' : 'border-border text-fg-muted hover:text-fg',
                )}
              >
                <Pin className="h-3 w-3" aria-hidden />
                Pinned
              </button>
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {messages.length === 0 && !pendingUser ? (
                <div className="grid h-full place-items-center text-center">
                  <div className="max-w-sm">
                    <Sparkles className="mx-auto h-8 w-8 text-fg-subtle" aria-hidden />
                    <p className="mt-2 text-sm font-medium">
                      {pinnedOnly ? 'No pinned messages here.' : `Ask your ${tutor.subject} tutor anything`}
                    </p>
                    <p className="mt-1 text-xs text-fg-subtle">
                      Explanations, worked examples, quizzes, flashcards — or drop a file to study from it.
                    </p>
                  </div>
                </div>
              ) : (
                messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    tutorId={tutorId}
                    accent={tutor.accent}
                    onRegenerate={m.role === 'MODEL' ? regenerate : undefined}
                    onTogglePin={() => updateMessage.mutate({ messageId: m.id, pinned: !m.pinned })}
                    onEdit={
                      m.role === 'USER'
                        ? (content) => updateMessage.mutate({ messageId: m.id, content })
                        : undefined
                    }
                    onQuizComplete={() => queryClient.invalidateQueries({ queryKey: tutorKeys.detail(tutorId) })}
                  />
                ))
              )}

              {pendingUser ? (
                <div className="flex flex-row-reverse gap-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-raised text-xs">🙂</span>
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-brand px-3.5 py-2 text-sm text-white">
                    {pendingUser}
                  </div>
                </div>
              ) : null}

              {streaming ? (
                <div className="flex gap-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm" style={{ backgroundColor: `${tutor.accent}22` }}>
                    {tutor.emoji}
                  </span>
                  <div className="max-w-[80%] rounded-2xl bg-surface-raised px-3.5 py-2 text-sm">
                    {streamText ? (
                      <MarkdownPreview content={streamText} />
                    ) : (
                      <span className="flex items-center gap-2 text-fg-subtle">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        Thinking…
                      </span>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Composer */}
            <div className="border-t border-border p-3">
              <AnimatePresence initial={false}>
                {pendingFiles.length > 0 ? (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-2 flex flex-wrap gap-2 overflow-hidden">
                    {pendingFiles.map((file) => (
                      <div key={file.localId} className={cn('flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs', file.status === 'error' ? 'border-danger/40 bg-danger/8' : 'border-border bg-surface-raised')}>
                        <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand/12 text-brand-bright">
                          {file.status === 'uploading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FileText className="h-3.5 w-3.5" aria-hidden />}
                        </span>
                        <span className="max-w-[9rem] truncate font-medium">{file.name}</span>
                        {file.status === 'ready' ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : null}
                        <button type="button" aria-label={`Remove ${file.name}`} onClick={() => removeFile(file.localId)} className="text-fg-subtle hover:text-danger">
                          <X className="h-3 w-3" aria-hidden />
                        </button>
                      </div>
                    ))}
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <div className="flex items-end gap-2">
                <input ref={fileInputRef} type="file" multiple accept={AI_FILE_ACCEPT} className="hidden" onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length > 0) void addFiles(files); e.target.value = ''; }} />
                <Button variant="ghost" size="icon" aria-label="Attach files" title="Attach files" onClick={() => fileInputRef.current?.click()}>
                  <Paperclip className="h-4 w-4" aria-hidden />
                </Button>
                <textarea
                  ref={composerRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
                  onPaste={(e) => { const files = Array.from(e.clipboardData.files ?? []); if (files.length > 0) { e.preventDefault(); void addFiles(files); } }}
                  rows={1}
                  placeholder={`Message your ${tutor.subject} tutor…`}
                  aria-label="Message the tutor"
                  className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
                />
                {streaming ? (
                  <Button variant="danger" onClick={stop} aria-label="Stop generating">
                    <StopCircle className="h-4 w-4" aria-hidden />
                    Stop
                  </Button>
                ) : (
                  <Button onClick={() => void handleSend()} disabled={uploading || !draft.trim()} aria-label="Send">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <SendHorizonal className="h-4 w-4" aria-hidden />}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* Insights */}
        <InsightsPanel
          tutorId={tutorId}
          detail={detail}
          onGenerate={() => genInsights.mutate()}
          generating={genInsights.isPending}
        />
      </div>
    </div>
  );
}

// --- Insights panel ---------------------------------------------------------

function InsightsPanel({
  tutorId,
  detail,
  onGenerate,
  generating,
}: {
  tutorId: string;
  detail: ReturnType<typeof useTutor>['data'];
  onGenerate: () => void;
  generating: boolean;
}) {
  const setDone = useSetRecommendationDone(tutorId);
  const insight = detail?.insight ?? null;
  const progress = detail?.progress;

  return (
    <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto xl:flex">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-brand-bright" aria-hidden />
            AI Insights
          </h2>
          <Button size="sm" variant="secondary" onClick={onGenerate} loading={generating} className="h-7 px-2 text-xs">
            <RefreshCw className="h-3 w-3" aria-hidden />
            {insight ? 'Refresh' : 'Generate'}
          </Button>
        </div>

        {/* Mastery + confidence gauges */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <RadialGauge label="Mastery" value={Math.round(progress?.masteryScore ?? 0)} tone="brand" />
          <RadialGauge label="Confidence" value={Math.round(progress?.confidenceScore ?? 0)} tone="teal" />
        </div>

        {insight ? (
          <div className="mt-4 space-y-3 text-xs">
            <div>
              <p className="mb-1 flex items-center gap-1 font-semibold text-fg">
                <Lightbulb className="h-3.5 w-3.5 text-warning" aria-hidden />
                Today&apos;s recommendation
              </p>
              <p className="text-fg-muted">{insight.todaysRecommendation}</p>
            </div>
            {insight.suggestedRevision ? (
              <div>
                <p className="mb-1 font-semibold text-fg">Suggested revision</p>
                <p className="text-fg-muted">{insight.suggestedRevision}</p>
              </div>
            ) : null}
            <p className="text-fg-subtle">{insight.summary}</p>
          </div>
        ) : (
          <p className="mt-4 text-xs text-fg-subtle">
            Generate insights to see today&apos;s recommendation, an estimated mastery score and what to revise
            next — built from your conversations and quizzes.
          </p>
        )}
      </Card>

      {progress && progress.weakTopics.length > 0 ? (
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">Weak topics</p>
          <div className="flex flex-wrap gap-1.5">
            {progress.weakTopics.map((topic) => (
              <span key={topic} className="rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                {topic}
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      {progress && progress.strongTopics.length > 0 ? (
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">Strong topics</p>
          <div className="flex flex-wrap gap-1.5">
            {progress.strongTopics.map((topic) => (
              <span key={topic} className="rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                {topic}
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      {detail?.recommendations && detail.recommendations.length > 0 ? (
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">Next actions</p>
          <ul className="space-y-2">
            {detail.recommendations.map((rec) => (
              <li key={rec.id} className="flex items-start gap-2 text-xs">
                <button
                  type="button"
                  aria-label={rec.done ? 'Mark not done' : 'Mark done'}
                  onClick={() => setDone.mutate({ id: rec.id, done: !rec.done })}
                  className={cn(
                    'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors',
                    rec.done ? 'border-success bg-success/20 text-success' : 'border-border text-transparent hover:border-brand',
                  )}
                >
                  <Check className="h-3 w-3" aria-hidden />
                </button>
                <div className={cn(rec.done && 'opacity-50 line-through')}>
                  <p className="font-medium text-fg">{rec.title}</p>
                  {rec.body ? <p className="text-fg-subtle">{rec.body}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </aside>
  );
}

function RadialGauge({ label, value, tone }: { label: string; value: number; tone: 'brand' | 'teal' }) {
  const color = tone === 'brand' ? 'var(--color-brand)' : 'var(--color-teal)';
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-2.5 text-center">
      <div className="relative mx-auto grid h-14 w-14 place-items-center">
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 36 36" aria-hidden>
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-border)" strokeWidth="3" />
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(value / 100) * 97.4} 97.4`}
          />
        </svg>
        <span className="text-sm font-semibold tabular-nums">{value}</span>
      </div>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-fg-subtle">{label}</p>
    </div>
  );
}

// --- Message bubble ---------------------------------------------------------

function MessageBubble({
  message,
  tutorId,
  accent,
  onRegenerate,
  onTogglePin,
  onEdit,
  onQuizComplete,
}: {
  message: TutorMessage;
  tutorId: string;
  accent: string;
  onRegenerate?: () => void;
  onTogglePin: () => void;
  onEdit?: (content: string) => void;
  onQuizComplete: () => void;
}) {
  const isUser = message.role === 'USER';
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);

  const quiz = message.data?.kind === 'quiz' ? message.data.quiz : null;
  const flashcards = message.data?.kind === 'flashcards' ? message.data.flashcards : null;

  function copy() {
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className={cn('group flex gap-2.5', isUser && 'flex-row-reverse')}>
      <span
        className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm', isUser && 'bg-surface-raised text-xs')}
        style={isUser ? undefined : { backgroundColor: `${accent}22` }}
      >
        {isUser ? '🙂' : '🎓'}
      </span>

      <div className={cn('flex min-w-0 max-w-[80%] flex-col gap-1', isUser && 'items-end')}>
        {message.pinned ? (
          <span className="flex items-center gap-1 text-[10px] font-medium text-brand-bright">
            <Pin className="h-2.5 w-2.5" aria-hidden />
            Pinned
          </span>
        ) : null}

        {editing ? (
          <div className="w-full">
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <div className="mt-1 flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setEditing(false); setEditValue(message.content); }}>
                Cancel
              </Button>
              <Button size="sm" className="h-7 px-2 text-xs" onClick={() => { onEdit?.(editValue.trim() || message.content); setEditing(false); }}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className={cn('rounded-2xl px-3.5 py-2 text-sm leading-relaxed', isUser ? 'whitespace-pre-wrap bg-brand text-white' : 'bg-surface-raised text-fg')}>
            {quiz ? (
              <QuizCard quiz={quiz} tutorId={tutorId} onComplete={onQuizComplete} />
            ) : flashcards ? (
              <FlashcardDeck data={flashcards} />
            ) : isUser ? (
              message.content
            ) : (
              <MarkdownPreview content={message.content} />
            )}
          </div>
        )}

        {/* Action row */}
        {!editing ? (
          <div className={cn('flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100', isUser && 'flex-row-reverse')}>
            {!quiz && !flashcards ? (
              <button type="button" onClick={copy} aria-label="Copy" className="rounded p-1 text-fg-subtle hover:text-fg">
                {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              </button>
            ) : null}
            <button type="button" onClick={onTogglePin} aria-label={message.pinned ? 'Unpin' : 'Pin'} className="rounded p-1 text-fg-subtle hover:text-brand-bright">
              {message.pinned ? <PinOff className="h-3.5 w-3.5" aria-hidden /> : <Pin className="h-3.5 w-3.5" aria-hidden />}
            </button>
            {onEdit ? (
              <button type="button" onClick={() => setEditing(true)} aria-label="Edit" className="rounded p-1 text-fg-subtle hover:text-fg">
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
            {onRegenerate ? (
              <button type="button" onClick={onRegenerate} aria-label="Regenerate" className="rounded p-1 text-fg-subtle hover:text-fg">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
            {message.edited ? <span className="text-[10px] text-fg-subtle">edited</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- Quiz --------------------------------------------------------------------

function QuizCard({ quiz, tutorId, onComplete }: { quiz: QuizData; tutorId: string; onComplete: () => void }) {
  const submit = useSubmitQuiz(tutorId);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const answeredAll = Object.keys(answers).length === quiz.questions.length;
  const correctCount = quiz.questions.reduce((n, q, i) => n + (answers[i] === q.correctIndex ? 1 : 0), 0);

  function finish() {
    if (submitted) return;
    setSubmitted(true);
    const missedTopics = quiz.questions
      .filter((q, i) => answers[i] !== q.correctIndex)
      .map((q) => q.topic ?? quiz.topic)
      .filter((t): t is string => Boolean(t));
    submit.mutate(
      { total: quiz.questions.length, correct: correctCount, topic: quiz.topic, missedTopics },
      { onSuccess: onComplete },
    );
  }

  return (
    <div className="w-full min-w-[16rem] space-y-3">
      <div className="flex items-center gap-2 font-semibold">
        <Wand2 className="h-4 w-4 text-brand-bright" aria-hidden />
        {quiz.title}
      </div>
      {quiz.questions.map((q, qi) => (
        <div key={qi} className="rounded-xl border border-border bg-surface p-2.5">
          <p className="mb-2 text-sm font-medium">{qi + 1}. {q.question}</p>
          <div className="space-y-1">
            {q.options.map((opt, oi) => {
              const chosen = answers[qi] === oi;
              const isCorrect = oi === q.correctIndex;
              const show = submitted;
              return (
                <button
                  key={oi}
                  type="button"
                  disabled={submitted}
                  onClick={() => setAnswers((prev) => ({ ...prev, [qi]: oi }))}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
                    show && isCorrect ? 'border-success bg-success/10 text-success' : '',
                    show && chosen && !isCorrect ? 'border-danger bg-danger/10 text-danger' : '',
                    !show && chosen ? 'border-brand bg-brand/10 text-brand-bright' : '',
                    !show && !chosen ? 'border-border hover:border-border-strong' : '',
                  )}
                >
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px]">
                    {String.fromCharCode(65 + oi)}
                  </span>
                  {opt}
                </button>
              );
            })}
          </div>
          {submitted ? <p className="mt-2 text-[11px] text-fg-muted">{q.explanation}</p> : null}
        </div>
      ))}

      {submitted ? (
        <div className="rounded-xl border border-brand/30 bg-brand/10 p-2.5 text-center text-sm font-semibold text-brand-bright">
          You scored {correctCount}/{quiz.questions.length}
        </div>
      ) : (
        <Button size="sm" className="w-full" disabled={!answeredAll || submit.isPending} onClick={finish}>
          {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Submit quiz
        </Button>
      )}
    </div>
  );
}

// --- Flashcards --------------------------------------------------------------

function FlashcardDeck({ data }: { data: FlashcardData }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = data.cards[index];
  if (!card) return null;

  return (
    <div className="w-full min-w-[16rem] space-y-2">
      <div className="flex items-center gap-2 font-semibold">
        <Layers className="h-4 w-4 text-teal" aria-hidden />
        {data.topic}
        <span className="ml-auto text-[11px] font-normal text-fg-subtle">{index + 1}/{data.cards.length}</span>
      </div>
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        className="grid min-h-[6rem] w-full place-items-center rounded-xl border border-border bg-surface p-3 text-center text-sm transition-colors hover:border-border-strong"
      >
        <div>
          <p className={cn('font-medium', flipped && 'text-fg-muted')}>{flipped ? card.back : card.front}</p>
          {!flipped && card.hint ? <p className="mt-1 text-[11px] text-fg-subtle">Hint: {card.hint}</p> : null}
          <p className="mt-2 text-[10px] uppercase tracking-wide text-fg-subtle">{flipped ? 'Answer' : 'Tap to flip'}</p>
        </div>
      </button>
      <div className="flex justify-between gap-2">
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={index === 0} onClick={() => { setIndex((i) => i - 1); setFlipped(false); }}>
          Prev
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={index === data.cards.length - 1} onClick={() => { setIndex((i) => i + 1); setFlipped(false); }}>
          Next
        </Button>
      </div>
    </div>
  );
}
