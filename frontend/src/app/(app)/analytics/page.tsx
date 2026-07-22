'use client';

import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  Award,
  BookOpen,
  Flame,
  Gauge,
  TrendingUp,
} from 'lucide-react';
import { StatCard } from '@/components/dashboard/stat-card';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnalytics } from '@/hooks/use-schedule';
import { apiErrorMessage } from '@/lib/api-client';
import { cn, formatMinutes } from '@/lib/utils';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Hour buckets shown in the weekday heatmap. */
const HOURS = Array.from({ length: 18 }, (_, index) => index + 6);

function formatAxisDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, isError, error } = useAnalytics(days);

  if (isError) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-warning" aria-hidden />
        <p className="mt-3 font-medium">Could not load analytics</p>
        <p className="mt-1 text-sm text-fg-muted">{apiErrorMessage(error)}</p>
      </Card>
    );
  }

  const peakMinutes =
    data?.weekdayHeatmap.reduce((peak, cell) => Math.max(peak, cell.minutes), 0) ?? 0;

  function heatColor(minutes: number): string {
    if (minutes === 0) return 'var(--color-surface-raised)';
    const ratio = peakMinutes === 0 ? 0 : minutes / peakMinutes;
    if (ratio <= 0.25) return 'color-mix(in oklab, var(--color-brand) 25%, transparent)';
    if (ratio <= 0.5) return 'color-mix(in oklab, var(--color-brand) 45%, transparent)';
    if (ratio <= 0.75) return 'color-mix(in oklab, var(--color-brand) 70%, transparent)';
    return 'var(--color-brand)';
  }

  function minutesAt(weekday: number, hour: number): number {
    return data?.weekdayHeatmap.find((cell) => cell.weekday === weekday && cell.hour === hour)
      ?.minutes ?? 0;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {data ? `${data.range.from} to ${data.range.to}` : 'Loading…'}
          </p>
        </div>

        <div className="flex gap-1.5">
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              aria-pressed={days === range.days}
              onClick={() => setDays(range.days)}
              className={cn(
                'rounded-xl border px-3 py-1.5 text-sm transition-colors',
                days === range.days
                  ? 'border-brand bg-brand/12 text-brand-bright'
                  : 'border-border text-fg-muted hover:border-border-strong',
              )}
            >
              {range.label}
            </button>
          ))}
        </div>
      </header>

      {data?.burnout.atRisk ? (
        <Card className="flex items-start gap-3 border-warning/30 bg-warning/8">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="font-medium text-warning">Consider taking a rest day</p>
            <p className="mt-0.5 text-sm text-fg-muted">{data.burnout.reason}</p>
          </div>
        </Card>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading || !data ? (
          Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-32 w-full rounded-2xl" />
          ))
        ) : (
          <>
            <StatCard
              label="Total study"
              value={formatMinutes(data.totals.studyMinutes)}
              icon={TrendingUp}
              tone="brand"
              hint={`${formatMinutes(data.averages.minutesPerDay)} a day on average`}
            />
            <StatCard
              label="Productivity"
              value={data.averages.productivityScore}
              icon={Gauge}
              tone={data.averages.productivityScore >= 60 ? 'success' : 'warning'}
              hint={`${data.totals.sessions} sessions`}
            />
            <StatCard
              label="Streak"
              value={`${data.streak.current}d`}
              icon={Flame}
              tone="teal"
              hint={`Best: ${data.streak.longest} days`}
            />
            <StatCard
              label="GPA"
              value={data.grades.gpa === null ? '—' : data.grades.gpa.toFixed(2)}
              icon={Award}
              tone="accent"
              hint={
                data.grades.overallAverage === null
                  ? 'No graded work yet'
                  : `${data.grades.overallAverage}% average`
              }
            />
          </>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Study time</CardTitle>
          <span className="text-xs text-fg-subtle">Minutes per day</span>
        </CardHeader>

        {isLoading || !data ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.daily} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="analyticsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatAxisDate}
                  tick={{ fill: 'var(--color-fg-subtle)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={28}
                />
                <YAxis
                  tick={{ fill: 'var(--color-fg-subtle)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface-raised)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  labelFormatter={formatAxisDate}
                  formatter={(value) => [`${Number(value ?? 0)} min`, 'Studied']}
                />
                <Area
                  type="monotone"
                  dataKey="studyMinutes"
                  stroke="var(--color-brand-bright)"
                  strokeWidth={2}
                  fill="url(#analyticsFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>When you study</CardTitle>
            <span className="text-xs text-fg-subtle">By weekday and hour</span>
          </CardHeader>

          {isLoading || !data ? (
            <Skeleton className="h-44 w-full" />
          ) : peakMinutes === 0 ? (
            <p className="py-10 text-center text-sm text-fg-muted">
              No sessions recorded in this range.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[26rem]">
                {WEEKDAYS.map((label, weekday) => (
                  <div key={label} className="mb-[3px] flex items-center gap-2">
                    <span className="w-8 shrink-0 text-[11px] text-fg-subtle">{label}</span>
                    <div className="flex gap-[3px]">
                      {HOURS.map((hour) => {
                        const minutes = minutesAt(weekday, hour);
                        return (
                          <div
                            key={hour}
                            title={`${label} ${hour}:00 — ${minutes} min`}
                            className="h-[14px] w-[14px] rounded-[2px]"
                            style={{ backgroundColor: heatColor(minutes) }}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="mt-1 flex gap-2 pl-10 text-[10px] text-fg-subtle">
                  <span>6am</span>
                  <span className="ml-auto">11pm</span>
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Time by subject</CardTitle>
          </CardHeader>

          {isLoading || !data ? (
            <Skeleton className="h-44 w-full" />
          ) : data.subjects.length === 0 ? (
            <p className="py-10 text-center text-sm text-fg-muted">No subjects yet.</p>
          ) : (
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.subjects}
                  layout="vertical"
                  margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={90}
                    tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--color-surface-raised)' }}
                    contentStyle={{
                      background: 'var(--color-surface-raised)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(value) => [formatMinutes(Number(value ?? 0)), 'Studied']}
                  />
                  <Bar dataKey="studyMinutes" radius={[0, 6, 6, 0]}>
                    {data.subjects.map((subject) => (
                      <Cell key={subject.subjectId} fill={subject.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {data && data.weakSubjects.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <span className="text-xs text-fg-subtle">Based on grades, completion and time</span>
          </CardHeader>

          <ul className="space-y-2">
            {data.weakSubjects.map((subject) => (
              <li
                key={subject.subjectId}
                className="flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/8 p-3"
              >
                <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                <div>
                  <p className="text-sm font-medium">{subject.name}</p>
                  <p className="text-sm text-fg-muted">{subject.reason}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {data && data.grades.bySubject.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Grades</CardTitle>
            <span className="text-xs text-fg-subtle">
              {data.grades.gpa !== null ? `GPA ${data.grades.gpa.toFixed(2)}` : ''}
            </span>
          </CardHeader>

          <ul className="space-y-2">
            {data.grades.bySubject.map((subject) => (
              <li key={subject.subjectId} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-sm text-fg-muted">
                  {subject.name}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-raised">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand to-accent"
                    style={{ width: `${Math.min(100, subject.average)}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-sm tabular-nums">
                  {subject.average}%
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
