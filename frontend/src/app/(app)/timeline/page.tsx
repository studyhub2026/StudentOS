'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Award,
  BookOpen,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  GraduationCap,
  ListTree,
  MessageSquare,
  Plus,
  Sparkles,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { useTimeline, type TimelineEvent, type TimelineEventKind } from '@/hooks/use-timeline';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n/dictionaries';

const KIND_ICON: Record<TimelineEventKind, LucideIcon> = {
  assignment_created: Plus,
  assignment_completed: CheckCircle2,
  study_session: BookOpen,
  focus_session: Timer,
  schedule_block: CalendarClock,
  achievement: Award,
  note_created: FileText,
  ai_conversation: Bot,
  tutor_conversation: GraduationCap,
};

const KIND_TONE: Record<TimelineEventKind, string> = {
  assignment_created: 'text-brand-bright bg-brand/12',
  assignment_completed: 'text-success bg-success/12',
  study_session: 'text-teal bg-teal/12',
  focus_session: 'text-accent bg-accent/12',
  schedule_block: 'text-sky-400 bg-sky-400/12',
  achievement: 'text-warning bg-warning/12',
  note_created: 'text-fg bg-surface-raised',
  ai_conversation: 'text-brand-bright bg-brand/12',
  tutor_conversation: 'text-brand-bright bg-brand/12',
};

const RANGES: { labelKey: TranslationKey; days: number }[] = [
  { labelKey: 'timeline.range.7d', days: 7 },
  { labelKey: 'timeline.range.30d', days: 30 },
  { labelKey: 'timeline.range.60d', days: 60 },
  { labelKey: 'timeline.range.1y', days: 365 },
];

/** Group events by their local calendar day for the sticky-date rail. */
function groupByDay(events: TimelineEvent[]): Array<{ day: string; iso: string; items: TimelineEvent[] }> {
  const groups = new Map<string, TimelineEvent[]>();
  for (const event of events) {
    const day = new Date(event.at).toDateString();
    const arr = groups.get(day) ?? [];
    arr.push(event);
    groups.set(day, arr);
  }
  return [...groups.entries()].map(([day, items]) => ({
    day: new Date(day).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    }),
    iso: day,
    items,
  }));
}

export default function TimelinePage() {
  const [days, setDays] = useState(60);
  const { data, isLoading, error } = useTimeline(days);
  const t = useT();

  const grouped = useMemo(() => (data ? groupByDay(data) : []), [data]);
  const totalMinutes = useMemo(
    () => (data ? data.reduce((sum, e) => sum + (e.minutes ?? 0), 0) : 0),
    [data],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ListTree className="h-5 w-5 text-brand-bright" aria-hidden />
            {t('timeline.title')}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {t('timeline.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-border bg-surface-raised p-1">
          {RANGES.map(({ labelKey, days: d }) => (
            <button
              key={labelKey}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={cn(
                'rounded-lg px-3 py-1 text-xs font-medium transition-colors',
                days === d ? 'bg-brand text-white' : 'text-fg-muted hover:text-fg',
              )}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </header>

      {data && data.length > 0 ? (
        <Card className="flex flex-wrap items-center gap-4 p-3 text-sm">
          <span className="flex items-center gap-1.5 text-fg-muted">
            <Sparkles className="h-4 w-4 text-brand-bright" aria-hidden />
            <strong className="text-fg">{data.length}</strong> {t('timeline.events')}
          </span>
          <span className="flex items-center gap-1.5 text-fg-muted">
            <Clock3 className="h-4 w-4" aria-hidden />
            <strong className="text-fg">
              {Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m
            </strong>{' '}
            {t('timeline.logged')}
          </span>
        </Card>
      ) : null}

      {error ? (
        <Card className="p-6 text-sm text-danger">{t('timeline.error')}</Card>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : data && data.length === 0 ? (
        <Card className="p-10 text-center text-sm text-fg-muted">
          {t('timeline.empty')}
        </Card>
      ) : (
        <ol className="relative border-l border-border pl-4 sm:pl-6">
          {grouped.map((group) => (
            <li key={group.iso} className="mb-6">
              <div className="sticky top-0 z-10 -ml-4 mb-2 bg-surface/85 pl-4 backdrop-blur sm:-ml-6 sm:pl-6">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-fg-subtle">
                  {group.day}
                </h2>
              </div>
              <ul className="space-y-2">
                {group.items.map((event, i) => (
                  <TimelineRow key={event.id} event={event} index={i} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TimelineRow({ event, index }: { event: TimelineEvent; index: number }) {
  const Icon = KIND_ICON[event.kind] ?? MessageSquare;
  const tone = KIND_TONE[event.kind] ?? 'text-fg bg-surface-raised';
  const timeLabel = new Date(event.at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const inner = (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.4) }}
      className="group flex items-start gap-3 rounded-xl border border-border bg-surface-raised/60 p-3 transition-colors hover:border-border-strong"
    >
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', tone)}>
        {event.icon ? (
          <span className="text-base leading-none">{event.icon}</span>
        ) : (
          <Icon className="h-4 w-4" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{event.title}</p>
        {event.subtitle ? (
          <p className="truncate text-xs text-fg-subtle">{event.subtitle}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs text-fg-subtle">
        {event.minutes ? <span className="tabular-nums">{event.minutes}m</span> : null}
        <span className="tabular-nums">{timeLabel}</span>
      </div>
    </motion.div>
  );

  return (
    <li>
      {event.url ? (
        <Link href={event.url} className="block">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  );
}
