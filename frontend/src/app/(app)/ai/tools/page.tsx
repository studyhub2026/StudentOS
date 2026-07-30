'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BookMarked,
  Check,
  FileQuestion,
  GraduationCap,
  HeartHandshake,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageSquare,
  Route as RouteIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useAiStatus,
  useCoach,
  useExam,
  useExplain,
  useLearningPath,
  useQuiz,
  useRevision,
  useSummarise,
} from '@/hooks/use-ai';
import { cn } from '@/lib/utils';

type ToolKey = 'quiz' | 'exam' | 'explain' | 'summarise' | 'revision' | 'path' | 'coach';

const TOOLS: { key: ToolKey; label: string; icon: typeof FileQuestion; blurb: string }[] = [
  { key: 'quiz', label: 'Quiz generator', icon: FileQuestion, blurb: 'Multiple-choice questions from your notes' },
  { key: 'exam', label: 'Exam simulator', icon: GraduationCap, blurb: 'A timed paper with a mark scheme' },
  { key: 'explain', label: 'Concept explainer', icon: Lightbulb, blurb: 'A clear breakdown of any idea' },
  { key: 'summarise', label: 'Summariser', icon: ListChecks, blurb: 'Condense notes to the essentials' },
  { key: 'revision', label: 'Revision sheet', icon: BookMarked, blurb: 'Key facts, definitions and tips' },
  { key: 'path', label: 'Learning path', icon: RouteIcon, blurb: 'A step-by-step plan to a goal' },
  { key: 'coach', label: 'Motivation coach', icon: HeartHandshake, blurb: 'A pep talk grounded in your week' },
];

export default function AiToolsPage() {
  const { data: status } = useAiStatus();
  const [tool, setTool] = useState<ToolKey>('quiz');

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <MessageSquare className="h-5 w-5 text-brand-bright" aria-hidden />
            AI Study Tools
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Structured helpers for revision.{' '}
            <Link href="/ai" className="text-brand-bright hover:underline">
              Open the chat →
            </Link>
          </p>
        </div>
      </header>

      {status && !status.configured ? (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-warning">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            AI is not configured
          </p>
          <p className="mt-1 text-fg-muted">
            The server needs a GEMINI_API_KEY before these tools can run.
          </p>
        </div>
      ) : null}

      <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {TOOLS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            aria-current={tool === key ? 'page' : undefined}
            onClick={() => setTool(key)}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center text-xs transition-colors',
              tool === key
                ? 'border-brand bg-brand/10 text-brand-bright'
                : 'border-border text-fg-muted hover:border-border-strong',
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
            {label}
          </button>
        ))}
      </nav>

      {tool === 'quiz' ? <QuizTool /> : null}
      {tool === 'exam' ? <ExamTool /> : null}
      {tool === 'explain' ? <ExplainTool /> : null}
      {tool === 'summarise' ? <SummariseTool /> : null}
      {tool === 'revision' ? <RevisionTool /> : null}
      {tool === 'path' ? <LearningPathTool /> : null}
      {tool === 'coach' ? <CoachTool /> : null}
    </div>
  );
}

/* --- shared bits ---------------------------------------------------------- */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40';
const areaCls =
  'w-full rounded-xl border border-border bg-surface-raised p-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/40';

function RunButton({ pending, disabled, label }: { pending: boolean; disabled: boolean; label: string }) {
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {pending ? 'Generating…' : label}
    </Button>
  );
}

function ResultCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      {children}
    </Card>
  );
}

/* --- Quiz ----------------------------------------------------------------- */

function QuizTool() {
  const [source, setSource] = useState('');
  const [count, setCount] = useState(10);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const quiz = useQuiz();

  return (
    <div className="space-y-4">
      <Card>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setRevealed(new Set());
            quiz.mutate({ source: source.trim(), count });
          }}
        >
          <Field label="Source material">
            <textarea
              rows={6}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Paste the notes to quiz yourself on…"
              className={areaCls}
            />
          </Field>
          <div className="flex items-end gap-3">
            <Field label="Questions">
              <input
                type="number"
                min={1}
                max={30}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className={cn(inputCls, 'w-24')}
              />
            </Field>
            <RunButton pending={quiz.isPending} disabled={source.trim().length < 20} label="Generate quiz" />
          </div>
        </form>
      </Card>

      {quiz.data ? (
        <div className="space-y-3">
          {quiz.data.questions.map((q, i) => {
            const show = revealed.has(i);
            return (
              <Card key={i}>
                <p className="font-medium">
                  {i + 1}. {q.question}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {q.options.map((opt, oi) => (
                    <li
                      key={oi}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm',
                        show && oi === q.correctIndex
                          ? 'border-success/40 bg-success/10 text-success'
                          : 'border-border',
                      )}
                    >
                      {show && oi === q.correctIndex ? (
                        <Check className="h-4 w-4 shrink-0" aria-hidden />
                      ) : (
                        <span className="grid h-4 w-4 shrink-0 place-items-center text-xs text-fg-subtle">
                          {String.fromCharCode(65 + oi)}
                        </span>
                      )}
                      {opt}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() =>
                    setRevealed((prev) => {
                      const next = new Set(prev);
                      next.has(i) ? next.delete(i) : next.add(i);
                      return next;
                    })
                  }
                  className="mt-2 text-xs font-medium text-brand-bright hover:underline"
                >
                  {show ? 'Hide answer' : 'Show answer'}
                </button>
                {show ? <p className="mt-1.5 text-sm text-fg-muted">{q.explanation}</p> : null}
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* --- Exam ----------------------------------------------------------------- */

function ExamTool() {
  const [source, setSource] = useState('');
  const [subject, setSubject] = useState('general');
  const [level, setLevel] = useState('undergraduate');
  const [questionCount, setQuestionCount] = useState(8);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const exam = useExam();

  return (
    <div className="space-y-4">
      <Card>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            exam.mutate({ source: source.trim(), subject, level, questionCount, durationMinutes });
          }}
        >
          <Field label="Source material">
            <textarea rows={5} value={source} onChange={(e) => setSource(e.target.value)} className={areaCls} placeholder="The syllabus or notes to examine…" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Subject"><input value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} /></Field>
            <Field label="Level"><input value={level} onChange={(e) => setLevel(e.target.value)} className={inputCls} /></Field>
            <Field label="Questions"><input type="number" min={1} max={30} value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))} className={inputCls} /></Field>
            <Field label="Duration (min)"><input type="number" min={10} max={300} value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} className={inputCls} /></Field>
          </div>
          <RunButton pending={exam.isPending} disabled={source.trim().length < 20} label="Build exam" />
        </form>
      </Card>

      {exam.data ? (
        <ResultCard title={exam.data.title}>
          <p className="mb-3 flex gap-2 text-xs text-fg-subtle">
            <Badge tone="info">{exam.data.durationMinutes} min</Badge>
            <Badge tone="neutral">{exam.data.totalMarks} marks</Badge>
          </p>
          <ol className="space-y-4">
            {exam.data.questions.map((q) => (
              <li key={q.number} className="border-t border-border pt-3 first:border-0 first:pt-0">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">
                    {q.number}. {q.question}
                  </p>
                  <span className="shrink-0 text-xs text-fg-subtle">[{q.marks}]</span>
                </div>
                <p className="mt-1.5 text-sm text-fg-muted">
                  <span className="font-medium text-fg">Mark scheme: </span>
                  {q.markScheme}
                </p>
              </li>
            ))}
          </ol>
        </ResultCard>
      ) : null}
    </div>
  );
}

/* --- Explain -------------------------------------------------------------- */

function ExplainTool() {
  const [concept, setConcept] = useState('');
  const [level, setLevel] = useState('undergraduate');
  const explain = useExplain();

  return (
    <div className="space-y-4">
      <Card>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            explain.mutate({ concept: concept.trim(), level });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Concept"><input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="e.g. eigenvectors, osmosis…" className={inputCls} /></Field>
            <Field label="Level"><input value={level} onChange={(e) => setLevel(e.target.value)} className={cn(inputCls, 'sm:w-40')} /></Field>
          </div>
          <RunButton pending={explain.isPending} disabled={concept.trim().length < 2} label="Explain" />
        </form>
      </Card>

      {explain.data ? (
        <ResultCard title={concept}>
          <dl className="space-y-3 text-sm">
            {[
              ['Definition', explain.data.definition],
              ['Explanation', explain.data.explanation],
              ['Example', explain.data.example],
              ['Common mistake', explain.data.commonMistake],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-fg-muted">{value}</dd>
              </div>
            ))}
          </dl>
          {explain.data.relatedConcepts.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {explain.data.relatedConcepts.map((c) => (
                <Badge key={c} tone="neutral">{c}</Badge>
              ))}
            </div>
          ) : null}
        </ResultCard>
      ) : null}
    </div>
  );
}

/* --- Summarise ------------------------------------------------------------ */

function SummariseTool() {
  const [source, setSource] = useState('');
  const summarise = useSummarise();

  return (
    <div className="space-y-4">
      <Card>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            summarise.mutate({ source: source.trim() });
          }}
        >
          <Field label="Notes to summarise">
            <textarea rows={7} value={source} onChange={(e) => setSource(e.target.value)} className={areaCls} placeholder="Paste your notes…" />
          </Field>
          <RunButton pending={summarise.isPending} disabled={source.trim().length < 20} label="Summarise" />
        </form>
      </Card>

      {summarise.data ? (
        <ResultCard title="Summary">
          <p className="text-sm text-fg-muted">{summarise.data.summary}</p>
          {summarise.data.keyPoints.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {summarise.data.keyPoints.map((p, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-bright" aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
          ) : null}
        </ResultCard>
      ) : null}
    </div>
  );
}

/* --- Revision ------------------------------------------------------------- */

function RevisionTool() {
  const [source, setSource] = useState('');
  const [topic, setTopic] = useState('');
  const revision = useRevision();

  return (
    <div className="space-y-4">
      <Card>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            revision.mutate({ source: source.trim(), topic: topic.trim() });
          }}
        >
          <Field label="Topic"><input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Thermodynamics" className={inputCls} /></Field>
          <Field label="Source material">
            <textarea rows={6} value={source} onChange={(e) => setSource(e.target.value)} className={areaCls} placeholder="The material to distil…" />
          </Field>
          <RunButton pending={revision.isPending} disabled={source.trim().length < 20 || topic.trim().length < 1} label="Build sheet" />
        </form>
      </Card>

      {revision.data ? (
        <ResultCard title={revision.data.topic}>
          <div className="space-y-4 text-sm">
            <Section title="Key facts">
              <ul className="space-y-1">{revision.data.keyFacts.map((f, i) => <li key={i} className="flex gap-2"><span className="text-brand-bright">•</span>{f}</li>)}</ul>
            </Section>
            {revision.data.definitions.length > 0 ? (
              <Section title="Definitions">
                <dl className="space-y-1.5">
                  {revision.data.definitions.map((d, i) => (
                    <div key={i}><dt className="font-medium">{d.term}</dt><dd className="text-fg-muted">{d.meaning}</dd></div>
                  ))}
                </dl>
              </Section>
            ) : null}
            {revision.data.formulae.length > 0 ? (
              <Section title="Formulae">
                <ul className="space-y-1 font-mono text-xs">{revision.data.formulae.map((f, i) => <li key={i}>{f}</li>)}</ul>
              </Section>
            ) : null}
            {revision.data.examTips.length > 0 ? (
              <Section title="Exam tips">
                <ul className="space-y-1">{revision.data.examTips.map((t, i) => <li key={i} className="flex gap-2"><span className="text-accent">→</span>{t}</li>)}</ul>
              </Section>
            ) : null}
          </div>
        </ResultCard>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">{title}</p>
      {children}
    </div>
  );
}

/* --- Learning path -------------------------------------------------------- */

function LearningPathTool() {
  const [goal, setGoal] = useState('');
  const [currentLevel, setCurrentLevel] = useState('beginner');
  const [hoursPerWeek, setHoursPerWeek] = useState(5);
  const path = useLearningPath();

  return (
    <div className="space-y-4">
      <Card>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            path.mutate({ goal: goal.trim(), currentLevel, hoursPerWeek });
          }}
        >
          <Field label="Goal"><input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Master single-variable calculus" className={inputCls} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Current level"><input value={currentLevel} onChange={(e) => setCurrentLevel(e.target.value)} className={inputCls} /></Field>
            <Field label="Hours per week"><input type="number" min={1} max={80} value={hoursPerWeek} onChange={(e) => setHoursPerWeek(Number(e.target.value))} className={inputCls} /></Field>
          </div>
          <RunButton pending={path.isPending} disabled={goal.trim().length < 5} label="Plan it" />
        </form>
      </Card>

      {path.data ? (
        <ResultCard title={path.data.goal}>
          <p className="mb-3"><Badge tone="info">{path.data.totalHours} hours total</Badge></p>
          <ol className="space-y-3">
            {path.data.steps.map((s) => (
              <li key={s.order} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/12 text-sm font-semibold text-brand-bright">{s.order}</span>
                <div>
                  <p className="font-medium">{s.title} <span className="text-xs font-normal text-fg-subtle">· {s.estimatedHours}h</span></p>
                  <p className="text-sm text-fg-muted">{s.description}</p>
                  <p className="mt-0.5 text-xs text-fg-subtle"><span className="font-medium">Mastery check: </span>{s.masteryCheck}</p>
                </div>
              </li>
            ))}
          </ol>
        </ResultCard>
      ) : null}
    </div>
  );
}

/* --- Coach ---------------------------------------------------------------- */

function CoachTool() {
  const [situation, setSituation] = useState('');
  const [includeStats, setIncludeStats] = useState(true);
  const coach = useCoach();

  return (
    <div className="space-y-4">
      <Card>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            coach.mutate({ situation: situation.trim(), includeStats });
          }}
        >
          <Field label="What's going on?">
            <textarea rows={4} value={situation} onChange={(e) => setSituation(e.target.value)} className={areaCls} placeholder="e.g. I'm behind on revision and feeling overwhelmed…" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={includeStats} onChange={(e) => setIncludeStats(e.target.checked)} className="h-4 w-4 rounded border-border accent-[var(--color-brand)]" />
            Let the coach reference my recent study activity
          </label>
          <RunButton pending={coach.isPending} disabled={situation.trim().length < 5} label="Get a pep talk" />
        </form>
      </Card>

      {coach.data ? (
        <ResultCard title="Your coach says">
          <p className="whitespace-pre-wrap text-sm text-fg-muted">{coach.data.message}</p>
        </ResultCard>
      ) : null}
    </div>
  );
}
