'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Database,
  FileText,
  Folder,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useKnowledgeCollections,
  useKnowledgeDocuments,
  useCreateCollection,
  useDeleteDocument,
  useAskKnowledge,
  useSearchKnowledge,
} from '@/hooks/use-knowledge';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

export default function KnowledgePage() {
  const [selectedCollection, setSelectedCollection] = useState<string | undefined>();
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [question, setQuestion] = useState('');
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'ai'; content: string; sources?: string[] }[]>([]);

  const { data: collections } = useKnowledgeCollections();
  const { data: documents } = useKnowledgeDocuments(selectedCollection);
  const createCollection = useCreateCollection();
  const deleteDocument = useDeleteDocument();
  const askKnowledge = useAskKnowledge();
  const { data: searchResults } = useSearchKnowledge(searchQuery);

  const handleCreateCollection = () => {
    if (!newCollectionName.trim()) return;
    createCollection.mutate({ name: newCollectionName });
    setNewCollectionName('');
    setShowNewCollection(false);
  };

  const handleAsk = async () => {
    const q = question.trim();
    if (!q || askKnowledge.isPending) return;
    setQuestion('');
    setChatMessages((prev) => [...prev, { role: 'user', content: q }]);
    askKnowledge.mutate(
      { question: q, collectionId: selectedCollection },
      {
        onSuccess: (result) => {
          setChatMessages((prev) => [...prev, { role: 'ai', content: result.answer, sources: result.sources }]);
        },
        onError: () => {
          setChatMessages((prev) => [...prev, { role: 'ai', content: 'Sorry, something went wrong.' }]);
        },
      },
    );
  };

  const handleUpload = async (files: FileList) => {
    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        const text = await file.text().catch(() => undefined);
        await apiClient.post('/knowledge', {
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          storageUrl: URL.createObjectURL(file),
          storageKey: `knowledge/${Date.now()}-${file.name}`,
          collectionId: selectedCollection,
          extractedText: text,
        });
      } catch {
        // silently skip failed uploads
      }
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-0 lg:flex-row">
      {/* Left: Collections & Documents */}
      <div className="flex w-full flex-col border-b border-border lg:w-80 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Database className="h-4 w-4 text-brand" />
          <h2 className="text-sm font-semibold">Knowledge Base</h2>
          <div className="flex-1" />
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-raised hover:text-fg"
            onClick={() => setShowNewCollection(true)}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {showNewCollection ? (
          <div className="flex gap-2 border-b border-border p-3">
            <Input
              placeholder="Collection name"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateCollection()}
              className="h-8 text-xs"
            />
            <Button size="sm" onClick={handleCreateCollection} loading={createCollection.isPending}>
              Add
            </Button>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto p-2">
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
              !selectedCollection ? 'bg-brand/12 text-brand-bright' : 'text-fg-muted hover:bg-surface-raised',
            )}
            onClick={() => setSelectedCollection(undefined)}
          >
            <FileText className="h-4 w-4" />
            All Documents
          </button>

          {collections?.map((c) => (
            <button
              key={c.id}
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                selectedCollection === c.id ? 'bg-brand/12 text-brand-bright' : 'text-fg-muted hover:bg-surface-raised',
              )}
              onClick={() => setSelectedCollection(c.id)}
            >
              <Folder className="h-4 w-4" style={{ color: c.color }} />
              <span className="flex-1 truncate text-left">{c.name}</span>
              <span className="text-xs text-fg-subtle">{c._count.documents}</span>
            </button>
          ))}
        </div>

        {/* Upload */}
        <div className="border-t border-border p-3">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-3 text-sm text-fg-muted transition-colors hover:border-brand/40 hover:text-fg">
            <Upload className="h-4 w-4" />
            Upload Documents
            <input
              type="file"
              className="hidden"
              multiple
              accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"
              onChange={(e) => e.target.files && void handleUpload(e.target.files)}
            />
          </label>
        </div>
      </div>

      {/* Middle: Document list */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
            <input
              type="text"
              placeholder="Search knowledge base..."
              className="h-9 w-full rounded-lg border border-border bg-surface-raised pl-8 pr-3 text-sm text-fg placeholder:text-fg-subtle focus:border-brand focus:outline-none"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {searchQuery && searchResults ? (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                Search Results ({searchResults.length})
              </h3>
              {searchResults.map((r) => (
                <div key={r.chunkId} className="rounded-xl border border-border p-3">
                  <p className="text-sm font-medium">{r.filename}</p>
                  <p className="mt-1 text-xs text-fg-subtle">Chunk {r.chunkIndex + 1}</p>
                  <p className="mt-2 text-xs text-fg-muted line-clamp-3">{r.content}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {documents?.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-fg-subtle">
                  <Database className="h-12 w-12 opacity-30" />
                  <p>No documents yet. Upload files to build your knowledge base.</p>
                </div>
              ) : null}

              {documents?.map((doc) => (
                <div
                  key={doc.id}
                  className="group flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:border-brand/30"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/12">
                    <FileText className="h-5 w-5 text-brand" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{doc.filename}</p>
                    <p className="text-xs text-fg-subtle">
                      {(doc.sizeBytes / 1024).toFixed(0)} KB · {doc.chunkCount} chunks
                      {doc.collection ? ` · ${doc.collection.name}` : ''}
                    </p>
                    {doc.tags.length > 0 ? (
                      <div className="mt-1 flex gap-1">
                        {doc.tags.map((t) => (
                          <span key={t} className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] text-fg-subtle">
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="hidden shrink-0 text-fg-subtle transition-colors hover:text-danger group-hover:block"
                    onClick={() => deleteDocument.mutate(doc.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: AI Chat */}
      <div className="flex w-full flex-col border-t border-border lg:w-96 lg:border-l lg:border-t-0">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Bot className="h-4 w-4 text-brand" />
          <h3 className="text-sm font-semibold">Ask Your Knowledge</h3>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {chatMessages.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center text-fg-subtle">
              <MessageSquare className="h-10 w-10 opacity-30" />
              <p className="text-sm">
                Ask questions about your uploaded documents. AI will search your knowledge base and cite sources.
              </p>
              <div className="mt-2 space-y-1.5 w-full">
                {[
                  'Summarize all my documents',
                  'Find mentions of key concepts',
                  'Generate flashcards from my notes',
                  'Compare two documents',
                ].map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs text-fg-muted transition-colors hover:border-brand/40 hover:bg-brand/8"
                    onClick={() => setQuestion(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-xl px-3 py-2.5 text-sm',
                    msg.role === 'user' ? 'ml-8 bg-brand/12' : 'mr-4 bg-surface-raised',
                  )}
                >
                  <pre className="whitespace-pre-wrap font-sans leading-relaxed">{msg.content}</pre>
                  {msg.sources?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {msg.sources.map((s) => (
                        <span key={s} className="rounded bg-brand/12 px-1.5 py-0.5 text-[10px] text-brand">
                          {s}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {askKnowledge.isPending ? (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-fg-subtle">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Searching knowledge base...
                </div>
              ) : null}
            </div>
          )}
        </div>

        <form
          className="flex items-end gap-2 border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void handleAsk();
          }}
        >
          <textarea
            className="min-h-[2.5rem] max-h-24 min-w-0 flex-1 resize-none rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand focus:outline-none"
            placeholder="Ask about your documents..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleAsk();
              }
            }}
            rows={1}
          />
          <button
            type="submit"
            disabled={!question.trim() || askKnowledge.isPending}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-white transition-colors hover:bg-brand-bright disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
