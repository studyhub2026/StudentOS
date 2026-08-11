'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Database,
  GraduationCap,
  History,
  Loader2,
  MapPin,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useExamWorkspace, type UpcomingExam } from '@/hooks/use-exam-workspace';
import { useExam, type ExamResult } from '@/hooks/use-ai';
import {
  useExamHistory,
  useExamAttempt,
  useQuestionBanks,
  useSaveQuestionBank,
  useDeleteQuestionBank,
  useStartExam,
  useSubmitExam,
  type ExamAttemptFull,
} from '@/hooks/use-exam-extended';
import { cn, formatDueDate } from '@/lib/utils';
import { apiErrorMessage } from '@/lib/api-client';
import { useT } from '@/lib/i18n/provider';

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
  const t = useT();
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
          {t('exam.title')}
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          {t('exam.subtitle')}
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
                  {t('exam.noUpcoming')}{' '}
                  <Link href="/schedule" className="text-brand-bright hover:underline">
                    {t('nav.schedule')}
                  </Link>
                  .
                </Card>
              )}
            </div>

            <Card className="space-y-2 p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-fg-subtle">
                {t('exam.upcoming')}
              </p>
              {upcoming.length === 0 ? (
                <p className="text-sm text-fg-subtle">{t('exam.nothingScheduled')}</p>
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
              {t('exam.weakTopics')}
            </h2>
            {weak.length === 0 ? (
              <Card className="p-6 text-sm text-fg-subtle">
                {t('exam.noWeak')}
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
                        {Math.round(s.masteryScore)}% {t('exam.mastery')}
                      </span>
                    </div>
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {s.weakTopics.slice(0, 6).map((topic) => (
                        <li
                          key={topic}
                          className="rounded-md bg-surface-raised px-2 py-0.5 text-xs text-fg-muted"
                        >
                          {topic}
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
                {t('exam.recentExams')}
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

          <ExamAttemptHistory />

          <QuestionBankSection />
        </>
      )}
    </div>
  );
}

function ExamHero({ exam }: { exam: UpcomingExam }) {
  const minutes = useLiveMinutes(exam.minutesToExam, exam.startAt);
  const parts = partsFrom(minutes);
  const urgent = minutes <= 24 * 60;
  const t = useT();

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
        <CountBox value={parts.days} label={t('exam.days')} />
        <CountBox value={parts.hours} label={t('exam.hours')} />
        <CountBox value={parts.minutes} label={t('exam.mins')} />
      </motion.div>

      {urgent ? (
        <p className="mt-4 flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 p-2 text-xs font-medium text-warning">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {t('exam.hero.less24h')}
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
  const [takingExam, setTakingExam] = useState<ExamAttemptFull | null>(null);
  const mutate = useExam();
  const saveBank = useSaveQuestionBank();
  const startExam = useStartExam();
  const t = useT();

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
          <Sparkles className="h-4 w-4 text-brand-bright" aria-hidden /> {t('exam.mockExam')}
        </CardTitle>
      </CardHeader>
      <form onSubmit={submit} className="grid gap-3 p-6 pt-0 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-fg-muted">{t('exam.field.subject')}</span>
          <input
            className="h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-fg-muted">{t('exam.field.level')}</span>
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
          <span className="mb-1 block text-xs text-fg-muted">{t('exam.field.questions')}</span>
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
          <span className="mb-1 block text-xs text-fg-muted">{t('exam.field.duration')}</span>
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
          <span className="mb-1 block text-xs text-fg-muted">{t('exam.field.source')}</span>
          <textarea
            rows={4}
            className="w-full rounded-xl border border-border bg-surface-raised p-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={t('exam.source.placeholder')}
          />
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={mutate.isPending || !source.trim()}>
            {mutate.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('exam.generating')}
              </>
            ) : (
              t('exam.generate')
            )}
          </Button>
        </div>
      </form>

      {paper && !takingExam ? (
        <div className="space-y-3 border-t border-border p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{paper.title}</p>
              <p className="text-xs text-fg-muted">
                {paper.durationMinutes} min · {paper.totalMarks} marks
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={saveBank.isPending}
                onClick={async () => {
                  try {
                    await saveBank.mutateAsync({
                      title: paper.title,
                      questions: paper.questions,
                    });
                    toast.success('Saved to question bank');
                  } catch (err) {
                    toast.error(apiErrorMessage(err));
                  }
                }}
              >
                <Database className="h-3.5 w-3.5" aria-hidden /> Save to Bank
              </Button>
              <Button
                size="sm"
                disabled={startExam.isPending}
                onClick={async () => {
                  try {
                    const attempt = await startExam.mutateAsync({
                      title: paper.title,
                      questions: paper.questions,
                      totalMarks: paper.totalMarks,
                      duration: paper.durationMinutes * 60,
                    });
                    setTakingExam(attempt);
                  } catch (err) {
                    toast.error(apiErrorMessage(err));
                  }
                }}
              >
                Take Exam
              </Button>
            </div>
          </div>
          <ol className="space-y-3 text-sm">
            {paper.questions.map((q, i) => (
              <li key={i} className="rounded-lg border border-border bg-surface-raised/60 p-3">
                <p className="font-medium">
                  Q{q.number ?? i + 1}. {q.question}{' '}
                  <span className="text-xs text-fg-subtle">({q.marks} {t('exam.marks')})</span>
                </p>
                {q.markScheme ? (
                  <details className="mt-2 text-xs text-fg-muted">
                    <summary className="cursor-pointer">{t('exam.markScheme.toggle')}</summary>
                    <p className="mt-1 whitespace-pre-wrap">{q.markScheme}</p>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {takingExam ? (
        <LiveExamSession
          attempt={takingExam}
          onFinish={() => {
            setTakingExam(null);
            setPaper(null);
          }}
        />
      ) : null}
    </Card>
  );
}

function LiveExamSession({ attempt, onFinish }: { attempt: ExamAttemptFull; onFinish: () => void }) {
  const questions = attempt.questions;
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const submitExam = useSubmitExam();
  const [result, setResult] = useState<ExamAttemptFull | null>(null);

  async function handleSubmit() {
    try {
      const res = await submitExam.mutateAsync({ attemptId: attempt.id, answers });
      setResult(res);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  if (result) {
    return (
      <div className="space-y-4 border-t border-border p-6">
        <ExamAnalysisPanel attempt={result} />
        <Button variant="outline" onClick={onFinish}>
          Back to Exam Mode
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 border-t border-border p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{attempt.title}</p>
        <p className="text-xs text-fg-muted">{attempt.totalMarks} marks</p>
      </div>
      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={i} className="rounded-lg border border-border bg-surface-raised/60 p-4">
            <p className="text-sm font-medium">
              Q{q.number ?? i + 1}. {q.question}{' '}
              <span className="text-xs text-fg-subtle">({q.marks} marks)</span>
            </p>
            <textarea
              rows={3}
              className="mt-2 w-full rounded-lg border border-border bg-surface p-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
              placeholder="Your answer..."
              value={answers[q.number ?? i + 1] ?? ''}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [q.number ?? i + 1]: e.target.value }))}
            />
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <Button onClick={handleSubmit} disabled={submitExam.isPending}>
          {submitExam.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Grading...
            </>
          ) : (
            'Submit Exam'
          )}
        </Button>
        <Button variant="outline" onClick={onFinish}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ExamAnalysisPanel({ attempt }: { attempt: ExamAttemptFull }) {
  const analysis = attempt.analysis;
  const pct = attempt.score != null ? Math.round((attempt.score / attempt.totalMarks) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/12">
          <span className="text-2xl font-bold text-brand-bright">{pct != null ? `${pct}%` : '?'}</span>
        </div>
        <div>
          <p className="text-sm font-semibold">{attempt.title}</p>
          <p className="text-xs text-fg-muted">
            {attempt.score ?? 0} / {attempt.totalMarks} marks
          </p>
        </div>
      </div>

      {analysis ? (
        <>
          <div className="space-y-2">
            {analysis.perQuestion.map((pq) => (
              <div
                key={pq.number}
                className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm"
              >
                {pq.marksAwarded >= (attempt.questions.find((q) => q.number === pq.number)?.marks ?? 1) ? (
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    Q{pq.number}: {pq.marksAwarded} marks
                  </p>
                  <p className="mt-0.5 text-xs text-fg-muted">{pq.feedback}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {analysis.strengths.length > 0 && (
              <div className="rounded-lg border border-success/20 bg-success/5 p-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-success">Strengths</p>
                <ul className="space-y-1 text-xs text-fg-muted">
                  {analysis.strengths.map((s, i) => (
                    <li key={i}>• {s}</li>
                  ))}
                </ul>
              </div>
            )}
            {analysis.weaknesses.length > 0 && (
              <div className="rounded-lg border border-warning/20 bg-warning/5 p-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-warning">Weaknesses</p>
                <ul className="space-y-1 text-xs text-fg-muted">
                  {analysis.weaknesses.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {analysis.recommendations.length > 0 && (
            <div className="rounded-lg border border-brand/20 bg-brand/5 p-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-brand-bright">Recommendations</p>
              <ul className="space-y-1 text-xs text-fg-muted">
                {analysis.recommendations.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-fg-muted">AI analysis unavailable for this attempt.</p>
      )}
    </div>
  );
}

function ExamAttemptHistory() {
  const { data: attempts, isLoading } = useExamHistory();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data: expanded } = useExamAttempt(expandedId);

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (!attempts || attempts.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-fg-subtle">
        <History className="h-3.5 w-3.5" aria-hidden /> Exam Attempt History
      </h2>
      <div className="space-y-2">
        {attempts.map((a) => {
          const pct = a.score != null ? Math.round((a.score / a.totalMarks) * 100) : null;
          const isExpanded = expandedId === a.id;
          return (
            <Card key={a.id} className="overflow-hidden">
              <button
                type="button"
                className="flex w-full items-center justify-between p-3 text-left text-sm hover:bg-surface-raised/60 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : a.id)}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
                      pct != null && pct >= 70
                        ? 'bg-success/12 text-success'
                        : pct != null
                          ? 'bg-warning/12 text-warning'
                          : 'bg-surface-raised text-fg-muted',
                    )}
                  >
                    {pct != null ? `${pct}%` : '—'}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.title}</span>
                    <span className="block text-xs text-fg-subtle">
                      {new Date(a.startedAt).toLocaleDateString()} · {a.subject?.name ?? ''}
                      {a.completedAt ? '' : ' · In progress'}
                    </span>
                  </span>
                </span>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                )}
              </button>
              {isExpanded && expanded ? (
                <div className="border-t border-border p-4">
                  <ExamAnalysisPanel attempt={expanded} />
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function QuestionBankSection() {
  const { data: banks, isLoading } = useQuestionBanks();
  const deleteBank = useDeleteQuestionBank();

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!banks || banks.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-fg-subtle">
        <Database className="h-3.5 w-3.5" aria-hidden /> Question Banks
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {banks.map((bank) => (
          <Card key={bank.id} className="flex items-center justify-between p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{bank.title}</p>
              <p className="text-xs text-fg-subtle">
                {bank.subject?.name ?? 'General'} · {new Date(bank.createdAt).toLocaleDateString()}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded p-1.5 text-fg-subtle hover:text-danger transition-colors"
              onClick={() => {
                void deleteBank.mutateAsync(bank.id).then(() => toast.success('Deleted'));
              }}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </Card>
        ))}
      </div>
    </section>
  );
}
