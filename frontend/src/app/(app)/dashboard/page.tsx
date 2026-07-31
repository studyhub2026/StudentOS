'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { motion, type Variants } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Flame,
  Layers,
  PenLine,
  Sparkles,
  Target,
  Timer,
  TrendingUp,
} from 'lucide-react';
import { ProgressRing } from '@/components/dashboard/progress-ring';
import { StatCard } from '@/components/dashboard/stat-card';
import { StudyTrendChart } from '@/components/dashboard/study-trend-chart';
import { SubjectBreakdownChart } from '@/components/dashboard/subject-breakdown-chart';
import { PriorityBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCardSkeleton, Skeleton } from '@/components/ui/skeleton';
import { useDashboard } from '@/hooks/use-dashboard';
import { apiErrorMessage } from '@/lib/api-client';
import { cn, formatDueDate, formatMinutes } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const QUOTES = [
  'Small, steady sessions beat cramming every time.',
  'The secret of getting ahead is getting started.',
  'Focus is a superpower. Protect it.',
  'A little progress each day adds up to big results.',
  'Review on schedule — that is what makes it stick.',
  'You do not have to be extreme, just consistent.',
  'Done is better than perfect. Start the next block.',
];

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

const QUICK_ACTIONS = [
  { href: '/ai', label: 'Ask AI', icon: Sparkles, tone: 'text-brand-bright bg-brand/12' },
  { href: '/notes', label: 'New note', icon: PenLine, tone: 'text-accent bg-accent/12' },
  { href: '/flashcards/review', label: 'Review cards', icon: Layers, tone: 'text-teal bg-teal/12' },
  { href: '/focus', label: 'Start focus', icon: Timer, tone: 'text-success bg-success/12' },
  { href: '/schedule', label: 'Plan day', icon: CalendarDays, tone: 'text-warning bg-warning/12' },
  { href: '/assignments', label: 'Assignments', icon: Target, tone: 'text-brand-bright bg-brand/12' },
];

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const { data, isLoading, isError, error, refetch } = useDashboard();

  const quote = useMemo(() => QUOTES[new Date().getDate() % QUOTES.length]!, []);
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  if (isError) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-warning" aria-hidden />
        <h2 className="mt-3 font-semibold">Could not load your dashboard</h2>
        <p className="mt-1 text-sm text-fg-muted">{apiErrorMessage(error)}</p>
        <Button className="mt-5" onClick={() => void refetch()}>
          Try again
        </Button>
      </Card>
    );
  }

  const score = data?.stats.productivityScore ?? 0;
  const completion = data?.assignments.completionRate ?? 0;

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="mx-auto max-w-6xl space-y-6"
    >
      {/* Hero command band */}
      <motion.section
        variants={item}
        className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-brand/15 via-surface-raised to-surface p-6 sm:p-8"
      >
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-brand/25 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 left-1/4 h-48 w-48 rounded-full bg-accent/15 blur-3xl" aria-hidden />

        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-bright">
              {dateLabel}
            </p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">
              {greeting()}
              {user ? `, ${user.name.split(' ')[0]}` : ''}
            </h1>
            <p className="mt-2 max-w-md text-sm text-fg-muted">{quote}</p>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/ai">
                <Button className="shadow-[0_8px_30px_-12px_var(--color-brand)]">
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Ask your AI tutor
                </Button>
              </Link>
              <Link href="/focus">
                <Button variant="secondary">
                  <Timer className="h-4 w-4" aria-hidden />
                  Start a focus session
                </Button>
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-center">
              <ProgressRing value={score} size={96} color="var(--color-brand)">
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{score}</p>
                  <p className="text-[10px] uppercase tracking-widest text-fg-subtle">Score</p>
                </div>
              </ProgressRing>
              <p className="mt-1.5 text-xs text-fg-muted">Productivity</p>
            </div>

            <div className="text-center">
              <div className="mx-auto grid h-[68px] w-[68px] place-items-center rounded-2xl border border-warning/25 bg-warning/12">
                <Flame className="h-7 w-7 text-warning" aria-hidden />
              </div>
              <p className="mt-1.5 text-lg font-semibold tabular-nums">
                {data?.stats.currentStreak ?? 0}
                <span className="text-sm text-fg-subtle">d</span>
              </p>
              <p className="text-xs text-fg-muted">Streak</p>
            </div>
          </div>
        </div>
      </motion.section>

      {/* Stat tiles */}
      <motion.section variants={item} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading || !data ? (
          Array.from({ length: 4 }, (_, index) => <StatCardSkeleton key={index} />)
        ) : (
          <>
            <StatCard
              label="Studied today"
              value={formatMinutes(data.stats.studyMinutesToday)}
              icon={Timer}
              tone="brand"
              hint={`${formatMinutes(data.stats.studyMinutesWeek)} this week`}
            />
            <StatCard
              label="Due this week"
              value={data.assignments.dueThisWeek}
              icon={CalendarClock}
              tone={data.assignments.overdue > 0 ? 'warning' : 'accent'}
              hint={
                data.assignments.overdue > 0
                  ? `${data.assignments.overdue} overdue`
                  : 'Nothing overdue'
              }
            />
            <StatCard
              label="Total XP"
              value={data.stats.totalXp.toLocaleString()}
              icon={TrendingUp}
              tone="teal"
              hint={`Best streak: ${data.stats.longestStreak} days`}
            />
            <StatCard
              label="Assignments done"
              value={`${data.assignments.completed}/${data.assignments.total}`}
              icon={CheckCircle2}
              tone={completion >= 60 ? 'success' : 'warning'}
              hint={`${completion}% completion rate`}
            />
          </>
        )}
      </motion.section>

      {/* Charts */}
      <motion.section variants={item} className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Study hours</CardTitle>
            <span className="text-xs text-fg-subtle">Last 14 days</span>
          </CardHeader>
          {isLoading || !data ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <StudyTrendChart data={data.trend} />
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Time by subject</CardTitle>
          </CardHeader>
          {isLoading || !data ? (
            <Skeleton className="h-52 w-full" />
          ) : (
            <SubjectBreakdownChart data={data.subjectBreakdown} />
          )}
        </Card>
      </motion.section>

      {/* Up next + Today */}
      <motion.section variants={item} className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Up next</CardTitle>
            <Link href="/assignments" className="text-xs text-brand-bright hover:underline">
              See all
            </Link>
          </CardHeader>

          {isLoading || !data ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          ) : data.upcoming.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              tone="text-success"
              title="You're all caught up"
              body="No assignments due. Add one to see it tracked here."
              cta={{ href: '/assignments', label: 'Add an assignment' }}
            />
          ) : (
            <ul className="space-y-2">
              {data.upcoming.map((assignment) => {
                const due = formatDueDate(assignment.dueAt);
                return (
                  <li key={assignment.id}>
                    <Link
                      href={`/assignments?highlight=${assignment.id}`}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised/60 p-3 transition-all hover:-translate-y-0.5 hover:border-border-strong"
                    >
                      <span
                        className="h-8 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: assignment.subject?.color ?? 'var(--color-border-strong)' }}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{assignment.title}</p>
                        <p className="truncate text-xs text-fg-subtle">
                          {assignment.subject?.name ?? 'No subject'} ·{' '}
                          <span className={due.urgent ? 'text-warning' : ''}>{due.label}</span>
                        </p>
                      </div>
                      <PriorityBadge priority={assignment.priority} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s schedule</CardTitle>
            <span className="text-xs text-fg-subtle">
              {data ? `${data.stats.focusSessionsToday} focus sessions` : ''}
            </span>
          </CardHeader>

          {isLoading || !data ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          ) : data.todaySchedule.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              tone="text-fg-subtle"
              title="Nothing scheduled today"
              body="Block out study time and it will appear here."
              cta={{ href: '/schedule', label: 'Plan your day' }}
            />
          ) : (
            <ul className="space-y-2">
              {data.todaySchedule.map((block) => (
                <li
                  key={block.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised/60 p-3"
                >
                  <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
                    {new Date(block.startAt).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span
                    className="h-8 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: block.color ?? block.subject?.color ?? 'var(--color-brand)' }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{block.title}</p>
                    <p className="truncate text-xs text-fg-subtle">
                      {block.subject?.name ?? block.type}
                      {block.location ? ` · ${block.location}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </motion.section>

      {/* Quick actions */}
      <motion.section variants={item}>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg-muted">
          <Sparkles className="h-4 w-4 text-brand-bright" aria-hidden />
          Quick actions
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {QUICK_ACTIONS.map(({ href, label, icon: Icon, tone }) => (
            <motion.div key={href} whileHover={{ y: -3 }} whileTap={{ scale: 0.97 }}>
              <Link
                href={href}
                className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-4 text-center transition-colors hover:border-border-strong"
              >
                <span className={cn('grid h-10 w-10 place-items-center rounded-xl', tone)}>
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-xs font-medium text-fg-muted">{label}</span>
              </Link>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* AI coach + flashcards due */}
      <motion.section variants={item} className="grid gap-4 lg:grid-cols-2">
        <Card className="relative overflow-hidden border-brand/25 bg-gradient-to-br from-brand/12 to-transparent">
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand/20 blur-2xl" aria-hidden />
          <div className="relative flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-brand/25 bg-brand/15">
              <Brain className="h-6 w-6 text-brand-bright" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Your AI study coach</p>
              <p className="mt-1 text-sm text-fg-muted">
                Feeling stuck or behind? Get a plan, a pep talk, or a concept explained in seconds.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/ai/tools">
                  <Button size="sm">Open study tools</Button>
                </Link>
                <Link href="/ai">
                  <Button size="sm" variant="secondary">
                    Chat now
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </Card>

        {data && data.stats.cardsDueToday > 0 ? (
          <Card className="flex items-center justify-between gap-4 border-teal/25 bg-teal/8">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl border border-teal/25 bg-teal/12">
                <Layers className="h-5 w-5 text-teal" aria-hidden />
              </span>
              <div>
                <p className="font-medium">
                  {data.stats.cardsDueToday} flashcard
                  {data.stats.cardsDueToday === 1 ? '' : 's'} ready
                </p>
                <p className="text-sm text-fg-muted">Keep your review streak alive.</p>
              </div>
            </div>
            <Link href="/flashcards/review">
              <Button size="sm">Review</Button>
            </Link>
          </Card>
        ) : (
          <Card className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-border bg-surface-raised">
              <Layers className="h-5 w-5 text-fg-subtle" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-medium">No cards due right now</p>
              <p className="text-sm text-fg-muted">
                Generate a deck from your notes with AI to start reviewing.
              </p>
            </div>
          </Card>
        )}
      </motion.section>
    </motion.div>
  );
}

function EmptyState({
  icon: Icon,
  tone,
  title,
  body,
  cta,
}: {
  icon: typeof CheckCircle2;
  tone: string;
  title: string;
  body: string;
  cta: { href: string; label: string };
}) {
  return (
    <div className="grid place-items-center py-8 text-center">
      <Icon className={cn('h-8 w-8', tone)} aria-hidden />
      <p className="mt-2 text-sm font-medium">{title}</p>
      <p className="mt-0.5 max-w-xs text-xs text-fg-subtle">{body}</p>
      <Link href={cta.href}>
        <Button variant="secondary" size="sm" className="mt-3">
          {cta.label}
        </Button>
      </Link>
    </div>
  );
}
