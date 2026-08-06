'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { PlannerDialog } from '@/components/schedule/planner-dialog';
import { BlockFormDialog } from '@/components/schedule/block-form-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDeleteBlock, useWeekSchedule } from '@/hooks/use-schedule';
import { apiErrorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { ScheduleBlockType } from '@/types/api';
import { useT } from '@/lib/i18n/provider';

/** Grid runs 07:00–23:00; earlier blocks are clamped into view. */
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 23;
const HOUR_HEIGHT_PX = 52;

const TYPE_COLOR: Record<ScheduleBlockType, string> = {
  CLASS: 'var(--color-accent)',
  STUDY: 'var(--color-brand)',
  FOCUS: 'var(--color-teal)',
  EXAM: 'var(--color-danger)',
  BREAK: 'var(--color-fg-subtle)',
  PERSONAL: 'var(--color-warning)',
};

function mondayOf(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return copy;
}

function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function SchedulePage() {
  const t = useT();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  const weekParam = useMemo(() => toISODate(weekStart), [weekStart]);
  const { data, isLoading, isError, error } = useWeekSchedule(weekParam);
  const deleteBlock = useDeleteBlock();

  const hours = useMemo(
    () => Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i),
    [],
  );

  const todayKey = toISODate(new Date());

  function shiftWeek(deltaWeeks: number) {
    setWeekStart((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + deltaWeeks * 7);
      return next;
    });
  }

  /** Converts a block's times into absolute grid offsets. */
  function positionOf(startAt: string, endAt: string) {
    const start = new Date(startAt);
    const end = new Date(endAt);

    const startMinutes = Math.max(
      0,
      (start.getHours() - DAY_START_HOUR) * 60 + start.getMinutes(),
    );
    const endMinutes = Math.min(
      (DAY_END_HOUR - DAY_START_HOUR) * 60,
      (end.getHours() - DAY_START_HOUR) * 60 + end.getMinutes(),
    );

    return {
      top: (startMinutes / 60) * HOUR_HEIGHT_PX,
      height: Math.max(18, ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT_PX),
    };
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('schedule.title')}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {weekStart.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} —{' '}
            {new Date(weekStart.getTime() + 6 * 864e5).toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setBlockOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add block
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPlannerOpen(true)}>
            <Sparkles className="h-4 w-4" aria-hidden />
            Plan my week
          </Button>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous week"
              onClick={() => shiftWeek(-1)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setWeekStart(mondayOf(new Date()))}>
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next week"
              onClick={() => shiftWeek(1)}
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      {isError ? (
        <Card className="text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-warning" aria-hidden />
          <p className="mt-3 font-medium">Could not load your timetable</p>
          <p className="mt-1 text-sm text-fg-muted">{apiErrorMessage(error)}</p>
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-[36rem] w-full rounded-2xl" />
      ) : (
        <Card className="overflow-x-auto p-0">
          {/* Minimum width keeps the 7 columns legible; the container scrolls
              horizontally on narrow screens rather than crushing them. */}
          <div className="min-w-[52rem]">
            <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-border">
              <div />
              {data?.days.map((day) => {
                const date = new Date(`${day.date}T00:00:00`);
                const isToday = day.date === todayKey;
                return (
                  <div
                    key={day.date}
                    className={cn(
                      'border-l border-border px-2 py-2.5 text-center',
                      isToday && 'bg-brand/8',
                    )}
                  >
                    <p className="text-xs text-fg-subtle">
                      {date.toLocaleDateString(undefined, { weekday: 'short' })}
                    </p>
                    <p
                      className={cn(
                        'mt-0.5 text-sm font-medium tabular-nums',
                        isToday && 'text-brand-bright',
                      )}
                    >
                      {date.getDate()}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
              <div>
                {hours.map((hour) => (
                  <div
                    key={hour}
                    style={{ height: HOUR_HEIGHT_PX }}
                    className="relative border-b border-border/50"
                  >
                    <span className="absolute -top-2 right-2 text-[11px] tabular-nums text-fg-subtle">
                      {String(hour).padStart(2, '0')}:00
                    </span>
                  </div>
                ))}
              </div>

              {data?.days.map((day) => (
                <div
                  key={day.date}
                  className={cn(
                    'relative border-l border-border',
                    day.date === todayKey && 'bg-brand/4',
                  )}
                >
                  {hours.map((hour) => (
                    <div
                      key={hour}
                      style={{ height: HOUR_HEIGHT_PX }}
                      className="border-b border-border/50"
                    />
                  ))}

                  {day.blocks.map((block) => {
                    const { top, height } = positionOf(block.startAt, block.endAt);
                    const color = block.color ?? block.subject?.color ?? TYPE_COLOR[block.type];

                    return (
                      <div
                        key={block.id}
                        style={{
                          top,
                          height,
                          backgroundColor: `${color}22`,
                          borderLeft: `3px solid ${color}`,
                        }}
                        className="group absolute inset-x-1 overflow-hidden rounded-md px-1.5 py-1 text-left transition-colors hover:brightness-125"
                      >
                        <p className="truncate text-[11px] font-medium leading-tight">
                          {block.title}
                        </p>
                        <p className="truncate text-[10px] text-fg-subtle">
                          {new Date(block.startAt).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {block.location ? ` · ${block.location}` : ''}
                        </p>

                        <button
                          type="button"
                          aria-label={`Delete ${block.title}`}
                          onClick={() => deleteBlock.mutate({ id: block.id })}
                          className="absolute right-0.5 top-0.5 rounded p-0.5 opacity-0 transition-opacity hover:bg-danger/20 focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3 w-3 text-danger" aria-hidden />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {data && data.totalBlocks === 0 && !isLoading ? (
        <Card className="py-10 text-center">
          <CalendarDays className="mx-auto h-9 w-9 text-fg-subtle" aria-hidden />
          <p className="mt-3 font-medium">Nothing scheduled this week</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">
            Add a block yourself, or let the planner build a week around your deadlines.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button size="sm" onClick={() => setBlockOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Add block
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPlannerOpen(true)}>
              <Sparkles className="h-4 w-4" aria-hidden />
              Plan my week
            </Button>
          </div>
        </Card>
      ) : null}

      {plannerOpen ? <PlannerDialog onClose={() => setPlannerOpen(false)} /> : null}
      {blockOpen ? (
        <BlockFormDialog defaultDate={weekStart} onClose={() => setBlockOpen(false)} />
      ) : null}
    </div>
  );
}
