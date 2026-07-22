'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { StudyTrendPoint } from '@/types/api';

/**
 * Shortens the ISO date key to a readable label. Recharts types axis ticks and
 * tooltip labels as ReactNode, so the input is narrowed here rather than cast
 * at each call site.
 */
function formatAxisDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function StudyTrendChart({ data }: { data: StudyTrendPoint[] }) {
  const hasActivity = data.some((point) => point.studyMinutes > 0);

  if (!hasActivity) {
    return (
      <div className="grid h-56 place-items-center text-center">
        <div>
          <p className="text-sm text-fg-muted">No study sessions recorded yet.</p>
          <p className="mt-1 text-xs text-fg-subtle">
            Start a focus session and your progress will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="studyFill" x1="0" y1="0" x2="0" y2="1">
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
            minTickGap={24}
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
            labelStyle={{ color: 'var(--color-fg-muted)' }}
            labelFormatter={formatAxisDate}
            formatter={(value) => [`${Number(value ?? 0)} min`, 'Studied']}
          />

          <Area
            type="monotone"
            dataKey="studyMinutes"
            stroke="var(--color-brand-bright)"
            strokeWidth={2}
            fill="url(#studyFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
