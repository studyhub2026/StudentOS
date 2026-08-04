'use client';

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
import { formatMinutes } from '@/lib/utils';
import type { Analytics } from '@/types/api';

function formatAxisDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Minutes-studied-per-day area chart. Split out so Recharts can be lazy-loaded. */
export function StudyTimeAreaChart({ daily }: { daily: Analytics['daily'] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
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
  );
}

/** Horizontal bar chart of minutes studied per subject. */
export function SubjectTimeBarChart({ subjects }: { subjects: Analytics['subjects'] }) {
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={subjects} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
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
            {subjects.map((subject) => (
              <Cell key={subject.subjectId} fill={subject.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
