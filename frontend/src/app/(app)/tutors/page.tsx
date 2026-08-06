'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BrainCircuit,
  GraduationCap,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { activateTutor, useTutors, type TutorCard } from '@/hooks/use-tutors';
import { apiErrorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/provider';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export default function TutorsPage() {
  const router = useRouter();
  const { data: tutors, isLoading } = useTutors();
  const t = useT();
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!tutors) return [];
    const q = query.trim().toLowerCase();
    if (!q) return tutors;
    return tutors.filter(
      (t) =>
        t.subject.toLowerCase().includes(q) ||
        t.tagline.toLowerCase().includes(q) ||
        t.weakTopics.some((w) => w.toLowerCase().includes(q)),
    );
  }, [tutors, query]);

  const subjectTutors = useMemo(
    () => filtered.filter((t) => (t.kind ?? 'subject') === 'subject'),
    [filtered],
  );
  const roleTutors = useMemo(
    () => filtered.filter((t) => t.kind === 'role'),
    [filtered],
  );

  const activeCount = tutors?.filter((t) => t.activated).length ?? 0;

  async function open(tutor: TutorCard) {
    if (opening) return;
    setOpening(tutor.subjectKey);
    try {
      const id = tutor.activated && tutor.id ? tutor.id : await activateTutor({ subjectKey: tutor.subjectKey });
      router.push(`/tutors/${id}`);
    } catch (error) {
      toast.error(apiErrorMessage(error));
      setOpening(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <GraduationCap className="h-6 w-6 text-brand-bright" aria-hidden />
              {t('tutors.title')}
            </h1>
            <p className="mt-1 text-sm text-fg-muted">
              {t('tutors.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Badge tone="brand">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {activeCount} {t('tutors.active')}
            </Badge>
          </div>
        </div>

        <div className="relative mt-4 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('tutors.searchPlaceholder')}
            aria-label={t('tutors.searchPlaceholder')}
            className="w-full rounded-xl border border-border bg-surface-raised py-2 pl-9 pr-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
          />
        </div>
      </header>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-52 w-full rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="grid place-items-center py-16 text-center">
          <BrainCircuit className="h-8 w-8 text-fg-subtle" aria-hidden />
          <p className="mt-2 text-sm font-medium">{t('tutors.noMatch')} “{query}”.</p>
        </Card>
      ) : (
        <div className="space-y-8">
          {subjectTutors.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fg-subtle">
                {t('tutors.section.subjects')}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {subjectTutors.map((tutor, index) => (
                  <TutorCardView
                    key={tutor.subjectKey}
                    tutor={tutor}
                    index={index}
                    opening={opening === tutor.subjectKey}
                    onOpen={() => void open(tutor)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {roleTutors.length > 0 ? (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-fg-subtle">
                {t('tutors.section.specialists')}
                <span className="rounded-full bg-brand/12 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-brand-bright">
                  {t('achievements.new')}
                </span>
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {roleTutors.map((tutor, index) => (
                  <TutorCardView
                    key={tutor.subjectKey}
                    tutor={tutor}
                    index={index}
                    opening={opening === tutor.subjectKey}
                    onOpen={() => void open(tutor)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TutorCardView({
  tutor,
  index,
  opening,
  onOpen,
}: {
  tutor: TutorCard;
  index: number;
  opening: boolean;
  onOpen: () => void;
}) {
  const mastery = Math.round(tutor.masteryScore);

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3), duration: 0.25 }}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface p-5 text-left shadow-[var(--shadow-float)] transition-all hover:-translate-y-0.5 hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
    >
      {/* Accent glow */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-15 blur-2xl transition-opacity group-hover:opacity-30"
        style={{ backgroundColor: tutor.accent }}
      />

      <div className="flex items-start justify-between gap-3">
        <span
          className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-2xl ring-1 ring-inset ring-white/10"
          style={{ backgroundColor: `${tutor.accent}22` }}
        >
          {tutor.emoji}
        </span>
        {tutor.activated ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="neutral">Start</Badge>
        )}
      </div>

      <h3 className="mt-3 text-lg font-semibold tracking-tight">{tutor.subject}</h3>
      <p className="mt-1 line-clamp-2 text-xs text-fg-subtle">{tutor.tagline}</p>

      {tutor.activated ? (
        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-fg-subtle">
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" aria-hidden />
                Mastery
              </span>
              <span className="font-medium tabular-nums text-fg-muted">{mastery}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${mastery}%`, backgroundColor: tutor.accent }}
              />
            </div>
          </div>

          {tutor.weakTopics.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {tutor.weakTopics.slice(0, 3).map((topic) => (
                <span
                  key={topic}
                  className="rounded-md border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                >
                  {topic}
                </span>
              ))}
            </div>
          ) : null}

          <p className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
            <MessageSquare className="h-3 w-3" aria-hidden />
            {tutor.lastConversation
              ? `${tutor.lastConversation.title.slice(0, 28)} · ${timeAgo(tutor.lastConversation.updatedAt)}`
              : `${tutor.conversationCount} conversation${tutor.conversationCount === 1 ? '' : 's'}`}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-xs text-fg-subtle">
          Tap to start — your first questions shape how this tutor teaches you.
        </p>
      )}

      <div
        className={cn(
          'mt-4 flex items-center gap-1.5 text-sm font-medium transition-colors',
          'text-brand-bright',
        )}
      >
        {opening ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Opening…
          </>
        ) : (
          <>
            {tutor.activated ? 'Continue' : 'Start learning'}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </>
        )}
      </div>
    </motion.button>
  );
}
