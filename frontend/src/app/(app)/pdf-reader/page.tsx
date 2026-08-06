'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  BookmarkPlus,
  Bot,
  Clock,
  FileText,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Send,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';
import { Button } from '@/components/ui/button';
import { useRecentPdfs, usePdfBookmarks } from '@/hooks/use-pdf-library';
import { useT } from '@/lib/i18n/provider';

interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

const MAX_PDF_AI_BYTES = 4 * 1024 * 1024;

export default function PdfReaderPage() {
  const t = useT();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfName, setPdfName] = useState('');
  const [pdfSize, setPdfSize] = useState<number | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [mobileTab, setMobileTab] = useState<'pdf' | 'chat'>('pdf');
  const zoom = 100;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const { recent, record: recordRecent, clear: clearRecent } = useRecentPdfs();
  const { bookmarks, add: addBookmark, remove: removeBookmark } = usePdfBookmarks(
    pdfName || null,
    pdfSize,
  );

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadFile = useCallback(
    (file: File) => {
      if (file.type !== 'application/pdf') return;
      setPdfName(file.name);
      setPdfSize(file.size);
      const url = URL.createObjectURL(file);
      setPdfUrl(url);
      recordRecent(file.name, file.size);

      if (file.size <= MAX_PDF_AI_BYTES) {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          setPdfBase64(base64 ?? null);
        };
        reader.readAsDataURL(file);
      } else {
        setPdfBase64(null);
      }
      setMessages([]);
    },
    [recordRecent],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) loadFile(file);
    },
    [loadFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadFile(file);
    },
    [loadFile],
  );

  const sendMessage = useCallback(async () => {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput('');
    const userMsg: ChatMessage = { role: 'user', content: msg };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const isFirstMessage = messages.length === 0;
      const { data } = await apiClient.post<ApiEnvelope<{ reply: string }>>(
        '/ai/pdf-chat',
        {
          message: msg,
          history: messages.slice(-20),
          documentName: pdfName,
          selectedText: selectedText || undefined,
          pdfBase64: isFirstMessage ? (pdfBase64 ?? undefined) : undefined,
        },
        { timeout: 90_000 },
      );
      setMessages((prev) => [...prev, { role: 'model', content: data.data.reply }]);
    } catch (err) {
      const detail =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data
              ?.error?.message
          : undefined;
      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          content: detail || 'Sorry, something went wrong. Please try again.',
        },
      ]);
    } finally {
      setLoading(false);
      setSelectedText('');
    }
  }, [input, loading, messages, pdfName, selectedText, pdfBase64]);

  useEffect(() => {
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) {
        setSelectedText(sel.toString().trim());
      }
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  const quickActions = useMemo(
    () => [
      { label: 'Summarize this PDF', prompt: 'Summarize this entire PDF document concisely.' },
      { label: 'Key concepts', prompt: 'What are the key concepts in this document?' },
      { label: 'Generate flashcards', prompt: 'Generate flashcards from this PDF document.' },
      { label: 'Generate quiz', prompt: 'Generate a quiz from this PDF document.' },
      { label: 'Find formulas', prompt: 'Find and list all formulas in this document.' },
      { label: 'Important definitions', prompt: 'Find all important definitions in this document.' },
      { label: 'Study plan for this material', prompt: 'Propose a 3-day study plan covering the material in this PDF, ordered from foundational to advanced.' },
      { label: 'Explain diagrams', prompt: 'For each diagram or figure in this document, describe what it shows and what it teaches.' },
      { label: 'Common exam questions', prompt: 'Predict 5 exam-style questions that could be drawn from this document, and answer each.' },
    ],
    [],
  );

  function bookmarkSelection() {
    if (!selectedText.trim()) {
      toast.info('Select text in the PDF first, then tap Bookmark.');
      return;
    }
    addBookmark(selectedText);
    toast.success('Bookmarked');
    setSelectedText('');
  }

  if (!pdfUrl) {
    return (
      <div
        className={cn(
          'flex min-h-[80vh] flex-col items-center justify-center gap-6',
          dragging && 'ring-2 ring-brand ring-offset-4 ring-offset-surface',
        )}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="grid h-20 w-20 place-items-center rounded-2xl bg-brand/12">
            <FileText className="h-10 w-10 text-brand" />
          </div>
          <h1 className="text-2xl font-bold">{t('pdf.title')}</h1>
          <p className="max-w-md text-center text-fg-muted">
            {t('pdf.subtitle')}
          </p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <Button onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            {t('pdf.upload')}
          </Button>
          <p className="text-xs text-fg-subtle">{t('pdf.dragHint')}</p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={handleFileSelect}
        />

        {recent.length > 0 ? (
          <div className="mt-8 w-full max-w-md">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-fg-subtle">
                <Clock className="h-3.5 w-3.5" aria-hidden /> Recent
              </p>
              <button
                type="button"
                onClick={clearRecent}
                className="text-xs text-fg-subtle hover:text-fg"
              >
                Clear
              </button>
            </div>
            <ul className="space-y-1.5">
              {recent.map((r) => (
                <li
                  key={`${r.name}-${r.size}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-raised/60 p-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate" title={r.name}>{r.name}</span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-brand-bright hover:underline"
                  >
                    Reopen
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-fg-subtle">
              Browser security requires you to re-pick the file when reopening.
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-0 lg:h-[calc(100vh-2rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <button
          type="button"
          onClick={() => { setPdfUrl(null); setPdfBase64(null); setMessages([]); }}
          className="flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{pdfName}</p>
        </div>

        {/* Mobile tab switcher */}
        <div className="flex rounded-lg border border-border bg-surface-raised p-0.5 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileTab('pdf')}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium transition-colors',
              mobileTab === 'pdf' ? 'bg-brand text-white' : 'text-fg-muted hover:text-fg',
            )}
          >
            PDF
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('chat')}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium transition-colors',
              mobileTab === 'chat' ? 'bg-brand text-white' : 'text-fg-muted hover:text-fg',
            )}
          >
            <Bot className="mr-1 inline h-3 w-3" />
            Chat
          </button>
        </div>

        <button
          type="button"
          className="grid h-8 w-8 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
          onClick={bookmarkSelection}
          title="Bookmark selected text"
          aria-label="Bookmark selection"
          disabled={!selectedText.trim()}
        >
          <BookmarkPlus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={cn(
            'grid h-8 w-8 place-items-center rounded-lg transition-colors',
            bookmarksOpen ? 'bg-brand/12 text-brand-bright' : 'text-fg-muted hover:bg-surface-raised hover:text-fg',
          )}
          onClick={() => setBookmarksOpen((v) => !v)}
          title="Bookmarks"
          aria-label="Toggle bookmarks"
        >
          <Bookmark className="h-4 w-4" />
          {bookmarks.length > 0 ? (
            <span className="ml-1 text-[10px] font-medium">{bookmarks.length}</span>
          ) : null}
        </button>

        {/* Desktop toggle */}
        <button
          type="button"
          className="hidden h-8 w-8 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg lg:grid"
          onClick={() => setChatOpen((v) => !v)}
          title={chatOpen ? 'Hide AI chat' : 'Show AI chat'}
        >
          {chatOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </button>
      </div>

      {bookmarksOpen ? (
        <div className="border-b border-border bg-surface-raised/60 px-4 py-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-fg-subtle">
              Bookmarks · {bookmarks.length}
            </p>
            <button
              type="button"
              onClick={() => setBookmarksOpen(false)}
              className="rounded p-0.5 text-fg-subtle hover:text-fg"
              aria-label="Close bookmarks"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {bookmarks.length === 0 ? (
            <p className="text-xs text-fg-subtle">
              Select any text in the PDF and tap the bookmark icon to save it.
            </p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {bookmarks.map((b) => (
                <li
                  key={b.id}
                  className="flex items-start gap-2 rounded-lg bg-surface p-2 text-xs"
                >
                  <span className="line-clamp-2 flex-1">{b.text}</span>
                  <button
                    type="button"
                    onClick={() => removeBookmark(b.id)}
                    className="rounded p-0.5 text-fg-subtle hover:text-danger"
                    aria-label="Remove bookmark"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* Split view */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* PDF Viewer — absolute so the iframe cannot push the chat away */}
        <div
          className={cn(
            'absolute inset-0 bg-neutral-900/30',
            chatOpen && 'lg:right-[40%]',
            mobileTab !== 'pdf' && 'hidden lg:block',
          )}
        >
          <iframe
            src={`${pdfUrl}#toolbar=1&view=FitH`}
            className="h-full w-full border-0"
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left', width: `${10000 / zoom}%`, height: `${10000 / zoom}%` }}
            title="PDF Viewer"
          />
        </div>

        {/* AI Chat Panel — pinned to the right 40% */}
        {(mobileTab === 'chat' || chatOpen) ? (
          <div
            className={cn(
              'absolute inset-y-0 right-0 flex flex-col border-l border-border bg-surface',
              chatOpen ? 'lg:w-[40%]' : 'lg:hidden',
              mobileTab === 'chat' ? 'left-0 lg:left-auto' : 'hidden lg:flex',
            )}
          >
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <Bot className="h-4 w-4 text-brand" />
                <h3 className="text-sm font-semibold">PDF AI Assistant</h3>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4">
                {messages.length === 0 ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-fg-muted">
                      {pdfBase64
                        ? 'Ask me anything about this PDF. I can explain, summarize, generate study materials, and more.'
                        : 'This PDF is too large for AI analysis (max 4 MB). You can still read it here, but AI features are unavailable for this file.'}
                    </p>
                    {selectedText ? (
                      <div className="rounded-lg border border-brand/20 bg-brand/8 p-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-brand">Selected Text</p>
                        <p className="mt-1 text-xs text-fg-muted line-clamp-3">{selectedText}</p>
                      </div>
                    ) : null}
                    <div className="mt-2 space-y-1.5">
                      {quickActions.map((qa) => (
                        <button
                          key={qa.label}
                          type="button"
                          className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs text-fg-muted transition-colors hover:border-brand/40 hover:bg-brand/8 hover:text-fg"
                          onClick={() => {
                            setInput(qa.prompt);
                          }}
                        >
                          {qa.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((msg, i) => (
                      <div
                        key={i}
                        className={cn(
                          'rounded-xl px-3 py-2.5 text-sm',
                          msg.role === 'user'
                            ? 'ml-8 bg-brand/12 text-fg'
                            : 'mr-4 bg-surface-raised text-fg',
                        )}
                      >
                        <pre className="whitespace-pre-wrap font-sans leading-relaxed">
                          {msg.content}
                        </pre>
                      </div>
                    ))}
                    {loading ? (
                      <div className="flex items-center gap-2 px-3 py-2 text-sm text-fg-subtle">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Thinking...
                      </div>
                    ) : null}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>

              {/* Selected text indicator */}
              {selectedText && messages.length > 0 ? (
                <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg bg-brand/8 px-2.5 py-1.5 text-xs text-brand">
                  <span className="truncate">Selected: &ldquo;{selectedText.slice(0, 60)}&rdquo;</span>
                  <button type="button" onClick={() => setSelectedText('')}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : null}

              {/* Input */}
              <form
                className="flex items-end gap-2 border-t border-border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendMessage();
                }}
              >
                <textarea
                  className="min-h-[2.5rem] max-h-32 min-w-0 flex-1 resize-none rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/50 disabled:opacity-50"
                  placeholder={pdfBase64 ? 'Ask about this PDF...' : 'PDF too large for AI'}
                  value={input}
                  disabled={!pdfBase64}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendMessage();
                    }
                  }}
                  rows={1}
                />
                <button
                  type="submit"
                  disabled={!pdfBase64 || !input.trim() || loading}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-white transition-colors hover:bg-brand-bright disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
