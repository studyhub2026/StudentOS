'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Award,
  BookOpen,
  Clock,
  Flame,
  Layers,
  Loader2,
  Play,
  Share2,
  Sparkles,
  Timer,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useReplay, type ReplayData } from '@/hooks/use-replay';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/provider';

const SCENE_MS = 5000;

export default function ReplayPage() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const [year, setYear] = useState(() => new Date().getUTCFullYear());
  const { data, isLoading } = useReplay(year);
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(false);

  const scenes = useMemo(() => (data ? buildScenes(data, user?.name) : []), [data, user]);

  useEffect(() => {
    if (!playing || scenes.length === 0) return;
    const t = setTimeout(() => {
      setScene((prev) => (prev + 1 < scenes.length ? prev + 1 : prev));
      if (scene + 1 >= scenes.length - 1) setPlaying(false);
    }, SCENE_MS);
    return () => clearTimeout(t);
  }, [scene, playing, scenes.length]);

  async function share() {
    const total = data ? Math.round(data.totals.studyMinutes / 60) : 0;
    const line = `My StudentOS ${year} Wrapped: ${total} hours studied, ${data?.totals.assignmentsCompleted ?? 0} assignments done. #StudentOSWrapped`;
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({ title: 'StudentOS Wrapped', text: line });
        return;
      } catch {
        /* fall through */
      }
    }
    await navigator.clipboard.writeText(line);
    toast.success('Copied recap to clipboard');
  }

  if (isLoading || !data) {
    return (
      <div className="grid min-h-[70vh] place-items-center text-fg-subtle">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      </div>
    );
  }

  const empty = data.totals.studyMinutes === 0 && data.totals.assignmentsCompleted === 0;
  if (empty) {
    return (
      <div className="mx-auto grid min-h-[70vh] max-w-md place-items-center px-4 text-center">
        <div>
          <Sparkles className="mx-auto h-8 w-8 text-brand-bright" aria-hidden />
          <h1 className="mt-3 text-2xl font-semibold">{t('replay.empty.title')}</h1>
          <p className="mt-2 text-sm text-fg-muted">
            {t('replay.empty.body')} {year}.
          </p>
          <YearSwitcher year={year} setYear={setYear} />
        </div>
      </div>
    );
  }

  const current = scenes[scene];

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-3xl flex-col px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-subtle">
            {t('replay.eyebrow')}
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{year}</h1>
        </div>
        <div className="flex items-center gap-2">
          <YearSwitcher year={year} setYear={setYear} />
          <Button variant="ghost" onClick={share}>
            <Share2 className="h-4 w-4" aria-hidden /> {t('replay.share')}
          </Button>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-brand/12 via-surface-raised to-accent/10 p-8">
        {/* AnimatePresence mode="wait" was leaving the outgoing scene
            un-exited when a new key mounted, freezing opacity at 0. A single
            motion.div re-animated on `scene` change avoids that entirely. */}
        <motion.div
          key={scene}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="flex h-full min-h-[300px] flex-col items-center justify-center text-center"
        >
          {current}
        </motion.div>

        {/* Scene rail */}
        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-1">
          {scenes.map((_, i) => (
            <button
              type="button"
              key={i}
              onClick={() => {
                setScene(i);
                setPlaying(false);
              }}
              aria-label={`Scene ${i + 1}`}
              className={cn(
                'h-1.5 w-8 rounded-full transition-colors',
                i === scene ? 'bg-brand' : 'bg-border',
              )}
            />
          ))}
        </div>
      </div>

      <footer className="mt-4 flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => setScene((s) => Math.max(0, s - 1))}
          disabled={scene === 0}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> {t('replay.previous')}
        </Button>
        <Button
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <Play className={cn('h-4 w-4', playing && 'opacity-40')} aria-hidden />
          {playing ? t('replay.playing') : t('replay.autoplay')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => setScene((s) => Math.min(scenes.length - 1, s + 1))}
          disabled={scene >= scenes.length - 1}
        >
          {t('replay.next')} <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </footer>
    </div>
  );
}

function YearSwitcher({ year, setYear }: { year: number; setYear: (y: number) => void }) {
  const current = new Date().getUTCFullYear();
  return (
    <div className="flex items-center gap-1 rounded-xl border border-border bg-surface-raised p-1">
      {[current - 1, current].map((y) => (
        <button
          key={y}
          type="button"
          onClick={() => setYear(y)}
          className={cn(
            'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
            year === y ? 'bg-brand text-white' : 'text-fg-muted hover:text-fg',
          )}
        >
          {y}
        </button>
      ))}
    </div>
  );
}

function Big({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 text-5xl font-black tracking-tight sm:text-7xl">{children}</p>
  );
}

function Kicker({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-brand-bright">
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </p>
  );
}

/**
 * The scene sequence. Each scene is a self-contained React node so the
 * animator can just fade between them without knowing what they render.
 * Only include scenes we actually have data for.
 */
function buildScenes(d: ReplayData, name: string | undefined): React.ReactNode[] {
  const scenes: React.ReactNode[] = [];
  const hours = Math.round(d.totals.studyMinutes / 60);

  scenes.push(
    <>
      <Kicker icon={Sparkles} label="Your year in review" />
      <p className="mt-4 text-lg text-fg-muted">
        {name ? `Hey ${name.split(' ')[0]},` : 'Hey,'} let&apos;s look back at what you did
      </p>
      <Big>{d.year}</Big>
    </>,
  );

  if (hours > 0) {
    scenes.push(
      <>
        <Kicker icon={Timer} label="Time on the books" />
        <Big>{hours}h</Big>
        <p className="mt-4 max-w-md text-sm text-fg-muted">
          That&apos;s {d.totals.sessions} focused sessions —
          {hours >= 100 ? ' a serious grind.' : ' every one of them counts.'}
        </p>
      </>,
    );
  }

  if (d.topSubject) {
    scenes.push(
      <>
        <Kicker icon={BookOpen} label="Subject of the year" />
        <Big>
          <span style={{ color: d.topSubject.color ?? undefined }}>{d.topSubject.name}</span>
        </Big>
        <p className="mt-4 text-sm text-fg-muted">
          {Math.round(d.topSubject.minutes / 60)}h invested. You picked a favourite.
        </p>
      </>,
    );
  }

  if (d.biggestDay && d.biggestDay.minutes > 0) {
    scenes.push(
      <>
        <Kicker icon={Flame} label="Biggest study day" />
        <Big>{d.biggestDay.minutes}m</Big>
        <p className="mt-4 text-sm text-fg-muted">
          On {new Date(d.biggestDay.date).toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
          . One for the highlight reel.
        </p>
      </>,
    );
  }

  if (d.favouriteHour !== null) {
    const label =
      d.favouriteHour < 6
        ? 'the small hours'
        : d.favouriteHour < 12
        ? 'the morning'
        : d.favouriteHour < 18
        ? 'the afternoon'
        : 'the evening';
    const twelve = ((d.favouriteHour + 11) % 12) + 1;
    const suffix = d.favouriteHour < 12 ? 'am' : 'pm';
    scenes.push(
      <>
        <Kicker icon={Clock} label="Peak study hour" />
        <Big>
          {twelve}
          {suffix}
        </Big>
        <p className="mt-4 text-sm text-fg-muted">You get things done in {label}.</p>
      </>,
    );
  }

  if (d.totals.assignmentsCompleted > 0 || d.totals.notesWritten > 0) {
    scenes.push(
      <>
        <Kicker icon={Layers} label="The output" />
        <div className="mt-2 grid grid-cols-2 gap-6 sm:grid-cols-3">
          {d.totals.assignmentsCompleted > 0 ? (
            <Tile value={d.totals.assignmentsCompleted} label="Assignments done" />
          ) : null}
          {d.totals.notesWritten > 0 ? (
            <Tile value={d.totals.notesWritten} label="Notes written" />
          ) : null}
          {d.totals.flashcardsReviewed > 0 ? (
            <Tile value={d.totals.flashcardsReviewed} label="Cards reviewed" />
          ) : null}
          {d.totals.longestStreak > 0 ? (
            <Tile value={d.totals.longestStreak} label="Longest streak (days)" />
          ) : null}
        </div>
      </>,
    );
  }

  if (d.achievements.length > 0) {
    scenes.push(
      <>
        <Kicker icon={Award} label="Trophies collected" />
        <Big>{d.totals.achievementsUnlocked}</Big>
        <div className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {d.achievements.map((a) => (
            <div key={a.name} className="flex flex-col items-center gap-1">
              <span className="text-2xl">{a.icon}</span>
              <span className="line-clamp-1 text-[10px] text-fg-subtle">{a.name}</span>
            </div>
          ))}
        </div>
      </>,
    );
  }

  scenes.push(
    <>
      <Kicker icon={Sparkles} label="See you in the new year" />
      <Big>Keep going.</Big>
      <p className="mt-4 max-w-md text-sm text-fg-muted">
        Every session added up. Next year&apos;s recap is already being written.
      </p>
    </>,
  );

  return scenes;
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-3xl font-black tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-widest text-fg-subtle">{label}</p>
    </div>
  );
}
