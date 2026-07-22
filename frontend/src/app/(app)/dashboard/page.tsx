'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Flame,
  Gauge,
  Layers,
  Timer,
} from 'lucide-react';
import { StatCard } from '@/components/dashboard/stat-card';
import { StudyTrendChart } from '@/components/dashboard/study-trend-chart';
import { SubjectBreakdownChart } from '@/components/dashboard/subject-breakdown-chart';
import { PriorityBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCardSkeleton, Skeleton } from '@/components/ui/skeleton';
import { useDashboard } from '@/hooks/use-dashboard';
import { apiErrorMessage } from '@/lib/api-client';
import { formatDueDate, formatMinutes } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const { data, isLoading, isError, error, refetch } = useDashboard();

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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting()}
            {user ? `, ${user.name.split(' ')[0]}` : ''}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>

        <Link href="/assignments">
          <Button variant="secondary" size="sm">
            View all assignments
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </Link>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
              label="Current streak"
              value={`${data.stats.currentStreak}d`}
              icon={Flame}
              tone="teal"
              hint={`Best: ${data.stats.longestStreak} days`}
            />
            <StatCard
              label="Productivity"
              value={data.stats.productivityScore}
              icon={Gauge}
              tone={data.stats.productivityScore >= 60 ? 'success' : 'warning'}
              hint={`${data.assignments.completionRate}% completion rate`}
            />
          </>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Study hours</CardTitle>
            <span className="text-xs text-fg-subtle">Last 14 days</span>
          </CardHeader>
          {isLoading || !data ? <Skeleton className="h-56 w-full" /> : <StudyTrendChart data={data.trend} />}
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
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
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
            <div className="py-8 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-success" aria-hidden />
              <p className="mt-2 text-sm text-fg-muted">Nothing due. Enjoy the breathing room.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {data.upcoming.map((assignment) => {
                const due = formatDueDate(assignment.dueAt);
                return (
                  <li key={assignment.id}>
                    <Link
                      href={`/assignments?highlight=${assignment.id}`}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised/60 p-3 transition-colors hover:border-border-strong"
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
            <div className="py-8 text-center">
              <CalendarClock className="mx-auto h-8 w-8 text-fg-subtle" aria-hidden />
              <p className="mt-2 text-sm text-fg-muted">No blocks scheduled today.</p>
              <Link href="/schedule">
                <Button variant="secondary" size="sm" className="mt-3">
                  Plan your day
                </Button>
              </Link>
            </div>
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
      </section>

      {data && data.stats.cardsDueToday > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-4 border-brand/25 bg-brand/8">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-brand/25 bg-brand/12">
              <Layers className="h-5 w-5 text-brand-bright" aria-hidden />
            </span>
            <div>
              <p className="font-medium">
                {data.stats.cardsDueToday} flashcard
                {data.stats.cardsDueToday === 1 ? '' : 's'} due for review
              </p>
              <p className="text-sm text-fg-muted">
                Reviewing on schedule is what makes spaced repetition work.
              </p>
            </div>
          </div>
          <Link href="/flashcards">
            <Button size="sm">Start review</Button>
          </Link>
        </Card>
      ) : null}
    </div>
  );
}
