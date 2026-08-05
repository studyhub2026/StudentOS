'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  GraduationCap,
  Loader2,
  MapPin,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useExamWorkspace, type UpcomingExam } from '@/hooks/use-exam-workspace';
import { useExam, type ExamResult } from '@/hooks/use-ai';
import { cn, formatDueDate } from '@/lib/utils';
import { apiErrorMessage } from '@/lib/api-client';

interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
}

function partsFrom(minutes: number): CountdownParts {
  const total = Math.max(0, minutes);
  return {
    days: Math.floor(total / (24 * 60)),
    hours: Math.floor((total % (24 * 60)) / 60),
    minutes: total % 60,
  };
}

/**
 * Live-updating countdown. Reads the initial "minutes to exam" from the server
 * response and ticks locally every 30 s so the display stays fresh without a
 * refetch.
 */
function useLiveMinutes(initialMinutes: number, startAt: string): number {
  const [minutes, setMinutes] = useState(initialMinutes);
  useEffect(() => {
    const target = new Date(startAt).getTime();
    setMinutes(Math.max(0, Math.round((target - Date.now()) / 60000)));
    const t = setInterval(() => {
      setMinutes(Math.max(0, Math.round((target - Date.now()) / 60000)));
    }, 30_000);
    return () => clearInterval(t);
  }, [startAt]);
  return minutes;
}

export default function ExamModePage() {
  const { data, isLoading } = useExamWorkspace();
  const upcoming = data?.upcoming ?? [];
  const past = data?.past ?? [];
  const weak = data?.weakTopicsBySubject ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => upcoming.find((e) => e.id === selectedId) ?? upcoming[0] ?? null,
    [upcoming, selectedId],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <GraduationCap className="h-5 w-5 text-brand-bright" aria-hidden />
          Exam Mode
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Countdown to what&apos;s next, weak topics to shore up, and a mock paper on demand.
        </p>
      </header>

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              {selected ? (
                <ExamHero exam={selected} />
              ) : (
                <Card className="p-8 text-center text-sm text-fg-muted">
                  <ClipboardList className="mx-auto mb-2 h-8 w-8 text-fg-subtle" aria-hidden />
                  No upcoming exams. Add one from{' '}
                  <Link href="/schedule" className="text-brand-bright hover:underline">
                    Schedule
                  </Link>
                  .
                </Card>
              )}
            </div>

            <Card className="space-y-2 p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-fg-subtle">
                Upcoming exams
              </p>
              {upcoming.length === 0 ? (
                <p className="text-sm text-fg-subtle">Nothing scheduled.</p>
              ) : (
                upcoming.map((exam) => (
                  <button
                    key={exam.id}
                    type="button"
                    onClick={() => setSelectedId(exam.id)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg border p-2 text-left text-sm transition-colors',
                      selected?.id === exam.id
                        ? 'border-brand bg-brand/10'
                        : 'border-border hover:border-border-strong',
                    )}
                  >
                    <span
                      className="mt-1 h-2 w-2 shrink-0 rounded-full"
                      style={{ background: exam.subject?.color ?? 'var(--color-brand)' }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{exam.title}</span>
                      <span className="block text-xs text-fg-subtle">
                        {formatDueDate(new Date(exam.startAt)).label}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </Card>
          </div>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fg-subtle">
              Weak topics to revise
            </h2>
            {weak.length === 0 ? (
              <Card className="p-6 text-sm text-fg-subtle">
                No weak-topic history yet — take a quiz from any AI Tutor to build one.
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {weak.map((s) => (
                  <Card key={s.subjectId} className="p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">{s.subjectName}</p>
                      <span
                        className={cn(
                          'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                          s.masteryScore >= 60
                            ? 'bg-success/12 text-success'
                            : 'bg-warning/12 text-warning',
                        )}
                      >
                        {s.masteryScore >= 60 ? (
                          <TrendingUp className="h-3 w-3" aria-hidden />
                        ) : (
                          <TrendingDown className="h-3 w-3" aria-hidden />
                        )}
                        {Math.round(s.masteryScore)}% mastery
                      </span>
                    </div>
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {s.weakTopics.slice(0, 6).map((t) => (
                        <li
                          key={t}
                          className="rounded-md bg-surface-raised px-2 py-0.5 text-xs text-fg-muted"
                        >
                          {t}
                        </li>
                      ))}
                    </ul>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <MockExamGenerator />

          {past.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fg-subtle">
                Recent exams
              </h2>
              <ul className="space-y-2">
                {past.map((exam) => (
                  <li
                    key={exam.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-surface-raised/60 p-3 text-sm"
                  >
                    <span>
                      <strong className="font-medium">{exam.title}</strong>{' '}
                      <span className="text-fg-subtle">
                        · {new Date(exam.startAt).toLocaleDateString()}
                      </span>
                    </span>
                    <span className="text-xs text-fg-subtle">{exam.subject?.name ?? ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function ExamHero({ exam }: { exam: UpcomingExam }) {
  const minutes = useLiveMinutes(exam.minutesToExam, exam.startAt);
  const parts = partsFrom(minutes);
  const urgent = minutes <= 24 * 60;

  return (
    <Card
      className="relative overflow-hidden p-6"
      style={{
        background: `linear-gradient(135deg, ${exam.subject?.color ?? '#6366f1'}18, transparent 60%)`,
      }}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-fg-subtle">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden />
        {exam.subject?.name ?? 'Exam'} · {new Date(exam.startAt).toLocaleString()}
      </p>
      <h2 className="mt-1 text-2xl font-bold tracking-tight">{exam.title}</h2>
      {exam.location ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-fg-muted">
          <MapPin className="h-3 w-3" aria-hidden /> {exam.location}
        </p>
      ) : null}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-4 flex items-end gap-4"
      >
        <CountBox value={parts.days} label="days" />
        <CountBox value={parts.hours} label="hours" />
        <CountBox value={parts.minutes} label="min" />
      </motion.div>

      {urgent ? (
        <p className="mt-4 flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 p-2 text-xs font-medium text-warning">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          Less than a day. Focus on quick wins.
        </p>
      ) : null}
    </Card>
  );
}

function CountBox({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-4xl font-black tabular-nums leading-none">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-widest text-fg-subtle">{label}</p>
    </div>
  );
}

/**
 * Wraps the existing /api/v1/ai/exam endpoint (via useExam) with an exam-mode
 * form. Kept small — the heavy lifting (Gemini call, schema validation) all
 * lives in ai.service.generateExam already.
 */
function MockExamGenerator() {
  const [subject, setSubject] = useState('Mathematics');
  const [source, setSource] = useState('');
  const [questionCount, setQuestionCount] = useState(5);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [level, setLevel] = useState('intermediate');
  const [paper, setPaper] = useState<ExamResult | null>(null);
  const mutate = useExam();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!source.trim()) return;
    try {
      const result = await mutate.mutateAsync({
        subject,
        source: source.trim(),
        questionCount,
        durationMinutes,
        level,
      });
      setPaper(result);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Sparkles className="h-4 w-4 text-brand-bright" aria-hidden /> Mock exam
        </CardTitle>
      </CardHeader>
      <form onSubmit={submit} className="grid gap-3 p-6 pt-0 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-fg-muted">Subject</span>
          <input
            className="h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-fg-muted">Level</span>
          <select
            className="h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option>beginner</option>
            <option>intermediate</option>
            <option>advanced</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-fg-muted">Questions</span>
          <input
            type="number"
            min={1}
            max={30}
            className="h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
            value={questionCount}
            onChange={(e) => setQuestionCount(Number(e.target.value))}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-fg-muted">Duration (min)</span>
          <input
            type="number"
            min={5}
            max={240}
            className="h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
          />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-xs text-fg-muted">Source material</span>
          <textarea
            rows={4}
            className="w-full rounded-xl border border-border bg-surface-raised p-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Paste chapter notes, a syllabus outline, or key definitions."
          />
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={mutate.isPending || !source.trim()}>
            {mutate.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Generating…
              </>
            ) : (
              'Generate mock exam'
            )}
          </Button>
        </div>
      </form>

      {paper ? (
        <div className="space-y-3 border-t border-border p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">{paper.title}</p>
            <p className="text-xs text-fg-muted">
              {paper.durationMinutes} min · {paper.totalMarks} marks
            </p>
          </div>
          <ol className="space-y-3 text-sm">
            {paper.questions.map((q, i) => (
              <li key={i} className="rounded-lg border border-border bg-surface-raised/60 p-3">
                <p className="font-medium">
                  Q{q.number ?? i + 1}. {q.question}{' '}
                  <span className="text-xs text-fg-subtle">({q.marks} marks)</span>
                </p>
                {q.markScheme ? (
                  <details className="mt-2 text-xs text-fg-muted">
                    <summary className="cursor-pointer">Show mark scheme</summary>
                    <p className="mt-1 whitespace-pre-wrap">{q.markScheme}</p>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  );
}
