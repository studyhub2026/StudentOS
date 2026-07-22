'use client';

import { useMemo } from 'react';

interface HeatmapGridProps {
  data: { date: string; count: number }[];
}

/**
 * GitHub-style contribution grid: one column per week, one cell per day.
 *
 * Intensity buckets are derived from the busiest day in the window rather than
 * fixed thresholds, so the grid stays readable whether a student reviews 5
 * cards a day or 500.
 */
export function HeatmapGrid({ data }: HeatmapGridProps) {
  const { weeks, max } = useMemo(() => {
    const highest = data.reduce((peak, point) => Math.max(peak, point.count), 0);

    // Pad the start so the first column begins on a Sunday.
    const first = data[0];
    const leading = first ? new Date(`${first.date}T00:00:00`).getDay() : 0;
    const padded: ({ date: string; count: number } | null)[] = [
      ...Array.from({ length: leading }, () => null),
      ...data,
    ];

    const grouped: ({ date: string; count: number } | null)[][] = [];
    for (let index = 0; index < padded.length; index += 7) {
      grouped.push(padded.slice(index, index + 7));
    }

    return { weeks: grouped, max: highest };
  }, [data]);

  function intensity(count: number): string {
    if (count === 0) return 'var(--color-surface-raised)';
    const ratio = max === 0 ? 0 : count / max;
    if (ratio <= 0.25) return 'color-mix(in oklab, var(--color-brand) 25%, transparent)';
    if (ratio <= 0.5) return 'color-mix(in oklab, var(--color-brand) 45%, transparent)';
    if (ratio <= 0.75) return 'color-mix(in oklab, var(--color-brand) 70%, transparent)';
    return 'var(--color-brand)';
  }

  const total = data.reduce((sum, point) => sum + point.count, 0);
  const activeDays = data.filter((point) => point.count > 0).length;

  return (
    <div>
      {/* Horizontal scroll keeps the grid intact on narrow screens. */}
      <div className="overflow-x-auto pb-1">
        <div className="flex gap-[3px]" style={{ minWidth: 'max-content' }}>
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-[3px]">
              {week.map((day, dayIndex) =>
                day ? (
                  <div
                    key={day.date}
                    title={`${day.count} review${day.count === 1 ? '' : 's'} on ${day.date}`}
                    className="h-[11px] w-[11px] rounded-[2px] transition-transform hover:scale-125"
                    style={{ backgroundColor: intensity(day.count) }}
                  />
                ) : (
                  <div key={`pad-${weekIndex}-${dayIndex}`} className="h-[11px] w-[11px]" />
                ),
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-fg-subtle">
        <span>
          {total} reviews across {activeDays} active day{activeDays === 1 ? '' : 's'}
        </span>

        <span className="flex items-center gap-1.5">
          Less
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <span
              key={ratio}
              className="h-[11px] w-[11px] rounded-[2px]"
              style={{ backgroundColor: intensity(ratio * max) }}
            />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
