'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatMinutes } from '@/lib/utils';
import type { SubjectBreakdown } from '@/types/api';

export function SubjectBreakdownChart({ data }: { data: SubjectBreakdown[] }) {
  const withTime = data.filter((entry) => entry.studyMinutes > 0);

  if (withTime.length === 0) {
    return (
      <div className="grid place-items-center py-4 text-center">
        <div>
          <p className="text-sm text-fg-muted">No time logged against subjects yet.</p>
          <p className="mt-1 text-xs text-fg-subtle">
            Link a focus session to a subject to see the split.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="h-40 w-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={withTime}
              dataKey="studyMinutes"
              nameKey="name"
              innerRadius={44}
              outerRadius={68}
              paddingAngle={2}
              stroke="none"
            >
              {withTime.map((entry) => (
                <Cell key={entry.subjectId} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'var(--color-surface-raised)',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                fontSize: 12,
              }}
              formatter={(value, name) => [formatMinutes(Number(value ?? 0)), String(name ?? '')]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="min-w-0 flex-1 space-y-2">
        {withTime.slice(0, 6).map((entry) => (
          <li key={entry.subjectId} className="flex items-center gap-2.5 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-fg-muted">{entry.name}</span>
            <span className="shrink-0 tabular-nums text-fg-subtle">
              {formatMinutes(entry.studyMinutes)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
