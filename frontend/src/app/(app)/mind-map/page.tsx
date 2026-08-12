'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  Copy,
  GitBranch,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import { useT } from '@/lib/i18n/provider';
import {
  useCreateMindMap,
  useDeleteMindMap,
  useDuplicateMindMap,
  useMindMaps,
  useRenameMindMap,
  type MindMapSummary,
} from '@/hooks/use-mind-maps';
import { cn } from '@/lib/utils';
import type { ApiEnvelope } from '@/types/api';

export default function MindMapListPage() {
  const t = useT();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [showAiPrompt, setShowAiPrompt] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const { data: maps, isLoading } = useMindMaps({ search: search || undefined });
  const create = useCreateMindMap();
  const duplicate = useDuplicateMindMap();
  const remove = useDeleteMindMap();
  const rename = useRenameMindMap();

  async function handleNew() {
    try {
      const map = await create.mutateAsync({ title: 'Untitled mind map' });
      router.push(`/mind-map/${map.id}`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function handleAiGenerate(payload: GenerateBody) {
    setAiBusy(true);
    try {
      const { data } = await apiClient.post<ApiEnvelope<{ id: string }>>('/mind-maps/generate', payload);
      toast.success('Mind map generated');
      router.push(`/mind-map/${data.data.id}`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setAiBusy(false);
      setShowAiPrompt(false);
    }
  }

  const sortedMaps = useMemo(() => maps ?? [], [maps]);
  const hasMaps = sortedMaps.length > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <GitBranch className="h-5 w-5 text-brand-bright" aria-hidden />
            {t('nav.mindMap')}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">{t('mindMap.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowAiPrompt(true)}>
            <Sparkles className="h-4 w-4" /> {t('mindMap.aiGenerate')}
          </Button>
          <Button onClick={handleNew} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('mindMap.new')}
          </Button>
        </div>
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('mindMap.searchPlaceholder')}
          className="w-full rounded-xl border border-border bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
        />
      </div>

      {showAiPrompt ? (
        <AiPromptCard busy={aiBusy} onSubmit={handleAiGenerate} onCancel={() => setShowAiPrompt(false)} />
      ) : null}

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
          ))}
        </div>
      ) : !hasMaps ? (
        <EmptyState onCreate={handleNew} onAi={() => setShowAiPrompt(true)} />
      ) : (
        <motion.div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.03 } } }}
        >
          {sortedMaps.map((m) => (
            <MapCard
              key={m.id}
              map={m}
              onOpen={() => router.push(`/mind-map/${m.id}`)}
              onDuplicate={async () => {
                try {
                  const dup = await duplicate.mutateAsync(m.id);
                  toast.success('Duplicated');
                  router.push(`/mind-map/${dup.id}`);
                } catch (err) {
                  toast.error(apiErrorMessage(err));
                }
              }}
              onFavorite={async () => {
                try {
                  await rename.mutateAsync({ id: m.id, favorite: !m.favorite });
                } catch (err) {
                  toast.error(apiErrorMessage(err));
                }
              }}
              onDelete={async () => {
                if (!confirm(`Delete "${m.title}"?`)) return;
                try {
                  await remove.mutateAsync(m.id);
                  toast.success('Deleted');
                } catch (err) {
                  toast.error(apiErrorMessage(err));
                }
              }}
            />
          ))}
        </motion.div>
      )}
    </div>
  );
}

function MapCard({
  map,
  onOpen,
  onDuplicate,
  onFavorite,
  onDelete,
}: {
  map: MindMapSummary;
  onOpen: () => void;
  onDuplicate: () => void;
  onFavorite: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
      className="group relative flex flex-col rounded-2xl border border-border bg-[var(--color-surface)] p-4 transition-colors hover:border-brand/40"
    >
      <button
        type="button"
        onClick={onFavorite}
        className={cn(
          'absolute right-3 top-3 rounded p-1 transition-colors',
          map.favorite
            ? 'text-warning'
            : 'text-fg-subtle opacity-0 hover:text-warning group-hover:opacity-100',
        )}
        aria-label={map.favorite ? 'Unfavorite' : 'Favorite'}
      >
        <Star className={cn('h-4 w-4', map.favorite && 'fill-current')} />
      </button>

      <button type="button" onClick={onOpen} className="text-left">
        <div className="flex items-center gap-2">
          {map.subject ? (
            <span
              className="h-6 w-1 rounded-full"
              style={{ backgroundColor: map.subject.color }}
              aria-hidden
            />
          ) : null}
          <p className="line-clamp-1 pr-6 text-sm font-semibold">{map.title}</p>
        </div>
        {map.description ? (
          <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{map.description}</p>
        ) : null}
        <p className="mt-3 text-xs text-fg-subtle">
          {map.nodeCount} {map.nodeCount === 1 ? 'node' : 'nodes'}
          {map.subject ? ` · ${map.subject.name}` : ''}
          {' · '}
          {new Date(map.updatedAt).toLocaleDateString()}
        </p>
      </button>

      <div className="mt-3 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={onDuplicate}
          className="rounded p-1 text-fg-subtle hover:text-fg"
          aria-label="Duplicate"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1 text-fg-subtle hover:text-danger"
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

function EmptyState({ onCreate, onAi }: { onCreate: () => void; onAi: () => void }) {
  const t = useT();
  return (
    <Card className="p-8 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/12">
        <GitBranch className="h-7 w-7 text-brand-bright" aria-hidden />
      </div>
      <p className="mt-4 text-lg font-semibold">{t('mindMap.emptyTitle')}</p>
      <p className="mt-1 text-sm text-fg-muted">{t('mindMap.emptyBody')}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button onClick={onCreate}>
          <Plus className="h-4 w-4" /> {t('mindMap.startFromScratch')}
        </Button>
        <Button variant="outline" onClick={onAi}>
          <Sparkles className="h-4 w-4" /> {t('mindMap.generateWithAi')}
        </Button>
        <Link href="/courses">
          <Button variant="ghost">{t('mindMap.startFromCourse')}</Button>
        </Link>
      </div>
    </Card>
  );
}

type GenerateSource = 'topic' | 'notes' | 'subject' | 'document' | 'lms_course';

interface GenerateBody {
  prompt: string;
  depth: 'shallow' | 'normal' | 'deep';
  subjectId?: string;
  noteIds?: string[];
  documentIds?: string[];
  lmsCourseId?: string;
  includeCourseContext?: boolean;
}

/**
 * Extended AI generation dialog — the source picker on top lets the student
 * bias generation with their own material (notes, KB docs, LMS courses) so
 * the resulting map is grounded in real content instead of pure Gemini
 * common-sense. The "Topic only" mode preserves the original single-textarea
 * behaviour so nothing regresses.
 */
function AiPromptCard({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (payload: GenerateBody) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const t = useT();
  const [prompt, setPrompt] = useState('');
  const [depth, setDepth] = useState<'shallow' | 'normal' | 'deep'>('normal');
  const [source, setSource] = useState<GenerateSource>('topic');
  const [pickedIds, setPickedIds] = useState<string[]>([]);

  const [libraryQuery, setLibraryQuery] = useState('');
  const { data: baseLib } = useQuery({
    queryKey: ['mind-map-library', libraryQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (libraryQuery) params.set('search', libraryQuery);
      const { data } = await apiClient.get<
        ApiEnvelope<{
          subjects: { id: string; name: string; color: string; code: string | null }[];
          notes: { id: string; title: string }[];
          assignments: { id: string; title: string }[];
        }>
      >(`/mind-maps/library${params.toString() ? `?${params.toString()}` : ''}`);
      return data.data;
    },
    enabled: source === 'notes' || source === 'subject',
    staleTime: 60_000,
  });
  const { data: extLib } = useQuery({
    queryKey: ['mind-map-library-extended', libraryQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (libraryQuery) params.set('search', libraryQuery);
      const { data } = await apiClient.get<
        ApiEnvelope<{
          documents: { id: string; filename: string }[];
          lmsCourses: { id: string; name: string; code: string | null }[];
        }>
      >(`/mind-maps/library-extended${params.toString() ? `?${params.toString()}` : ''}`);
      return data.data;
    },
    enabled: source === 'document' || source === 'lms_course',
    staleTime: 60_000,
  });

  const pickerItems = (() => {
    if (source === 'notes')
      return (baseLib?.notes ?? []).map((n) => ({ id: n.id, label: n.title, sub: 'Note' }));
    if (source === 'subject')
      return (baseLib?.subjects ?? []).map((s) => ({
        id: s.id,
        label: s.name,
        sub: s.code ?? 'Subject',
      }));
    if (source === 'document')
      return (extLib?.documents ?? []).map((d) => ({
        id: d.id,
        label: d.filename,
        sub: 'Knowledge doc',
      }));
    if (source === 'lms_course')
      return (extLib?.lmsCourses ?? []).map((c) => ({
        id: c.id,
        label: c.name,
        sub: c.code ?? 'LMS course',
      }));
    return [];
  })();

  function togglePick(id: string) {
    setPickedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function submit() {
    const p = prompt.trim();
    if (p.length < 3) return;
    const body: GenerateBody = { prompt: p, depth };
    if (source === 'notes' && pickedIds.length > 0) body.noteIds = pickedIds.slice(0, 5);
    if (source === 'subject' && pickedIds[0]) {
      body.subjectId = pickedIds[0];
      body.includeCourseContext = true;
    }
    if (source === 'document' && pickedIds.length > 0) body.documentIds = pickedIds.slice(0, 3);
    if (source === 'lms_course' && pickedIds[0]) body.lmsCourseId = pickedIds[0];
    onSubmit(body);
  }

  const needsPick = source !== 'topic';
  const canSubmit = prompt.trim().length >= 3 && (!needsPick || pickedIds.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Sparkles className="h-4 w-4 text-brand-bright" aria-hidden /> {t('mindMap.aiPromptTitle')}
        </CardTitle>
      </CardHeader>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-1 rounded-lg bg-surface-raised/60 p-1">
          {(
            [
              { k: 'topic', label: 'Topic only' },
              { k: 'notes', label: 'From notes' },
              { k: 'subject', label: 'From subject' },
              { k: 'document', label: 'From KB doc' },
              { k: 'lms_course', label: 'From LMS course' },
            ] as const
          ).map(({ k, label }) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setSource(k);
                setPickedIds([]);
              }}
              className={cn(
                'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                source === k ? 'bg-brand/12 text-brand-bright' : 'text-fg-muted hover:text-fg',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <textarea
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('mindMap.aiPromptPlaceholder')}
          className="w-full rounded-xl border border-border bg-surface-raised p-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
        />

        {needsPick ? (
          <div>
            <input
              value={libraryQuery}
              onChange={(e) => setLibraryQuery(e.target.value)}
              placeholder="Search…"
              className="mb-1.5 w-full rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs outline-none focus:border-brand"
            />
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
              {pickerItems.length === 0 ? (
                <p className="p-3 text-center text-xs text-fg-subtle">Nothing found.</p>
              ) : (
                pickerItems.map((it) => {
                  const picked = pickedIds.includes(it.id);
                  return (
                    <label
                      key={it.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs hover:bg-surface-raised',
                        picked && 'bg-brand/8',
                      )}
                    >
                      <input
                        type={source === 'subject' || source === 'lms_course' ? 'radio' : 'checkbox'}
                        name="picker"
                        checked={picked}
                        onChange={() => {
                          if (source === 'subject' || source === 'lms_course') {
                            setPickedIds([it.id]);
                          } else {
                            togglePick(it.id);
                          }
                        }}
                        className="shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      <span className="text-fg-subtle">{it.sub}</span>
                    </label>
                  );
                })
              )}
            </div>
            <p className="mt-1 text-[10px] text-fg-subtle">
              {source === 'notes'
                ? 'Up to 5 notes; excerpts (~400 chars) bias the AI.'
                : source === 'subject'
                  ? 'Assignments, LMS files and announcements from this subject are included.'
                  : source === 'document'
                    ? 'Up to 3 documents; the first ~2000 chars of each are shared.'
                    : 'Assignments, files and announcements from this course are included.'}
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-fg-muted">Depth:</span>
            {(['shallow', 'normal', 'deep'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDepth(d)}
                className={cn(
                  'rounded-md border px-2 py-0.5 transition-colors',
                  depth === d
                    ? 'border-brand bg-brand/12 text-brand-bright'
                    : 'border-border text-fg-muted hover:border-border-strong',
                )}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="ml-auto flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={submit} disabled={busy || !canSubmit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {t('mindMap.generate')}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
