'use client';

import { useEffect, useState } from 'react';
import { CalendarCheck, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApplyPlan, useGeneratePlan } from '@/hooks/use-schedule';
import { formatMinutes } from '@/lib/utils';
import type { StudyPlan } from '@/types/api';

interface PlannerDialogProps {
  onClose: () => void;
}

/**
 * Generate → review → apply. The plan is computed server-side and shown for
 * confirmation; nothing lands on the calendar until the student accepts it.
 */
export function PlannerDialog({ onClose }: PlannerDialogProps) {
  const [days, setDays] = useState(7);
  const [dayStartHour, setDayStartHour] = useState(9);
  const [dayEndHour, setDayEndHour] = useState(21);
  const [plan, setPlan] = useState<StudyPlan | null>(null);

  const generate = useGeneratePlan();
  const apply = useApplyPlan();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const byDate = plan
    ? plan.sessions.reduce<Record<string, typeof plan.sessions>>((groups, session) => {
        (groups[session.date] ??= []).push(session);
        return groups;
      }, {})
    : {};

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Plan my week"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="glass relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl p-6">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4 text-brand-bright" aria-hidden />
            Plan my week
          </h2>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {plan ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-brand/25 bg-brand/8 p-4">
                <p className="text-sm font-medium">
                  {formatMinutes(plan.totalMinutes)} scheduled across {plan.sessions.length}{' '}
                  sessions
                </p>
                {plan.advice ? (
                  <p className="mt-2 text-sm text-fg-muted">{plan.advice}</p>
                ) : (
                  <p className="mt-2 text-xs text-fg-subtle">
                    AI commentary unavailable — the schedule itself is computed locally and is
                    unaffected.
                  </p>
                )}
              </div>

              {plan.unscheduled.length > 0 ? (
                <div className="rounded-xl border border-warning/30 bg-warning/10 p-3">
                  <p className="text-sm font-medium text-warning">
                    Could not fit {plan.unscheduled.length} task
                    {plan.unscheduled.length === 1 ? '' : 's'}
                  </p>
                  <ul className="mt-1 ml-4 list-disc text-sm text-fg-muted">
                    {plan.unscheduled.map((task) => (
                      <li key={task.id}>
                        {task.title} ({formatMinutes(task.estimatedMinutes)})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="space-y-3">
                {Object.entries(byDate).map(([date, sessions]) => (
                  <div key={date}>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle">
                      {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
                        weekday: 'long',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                    <ul className="space-y-1">
                      {sessions.map((session, index) => (
                        <li
                          key={`${session.taskId}-${index}`}
                          className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                        >
                          <span className="shrink-0 tabular-nums text-xs text-fg-subtle">
                            {new Date(session.startAt).toLocaleTimeString(undefined, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{session.title}</span>
                          <span className="shrink-0 text-xs text-fg-subtle">
                            {session.minutes}m
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-fg-muted">
                The planner reads your outstanding assignments and existing calendar, then fills
                the gaps around what is already booked.
              </p>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="plan-days" className="mb-1.5 block text-sm font-medium text-fg-muted">
                    Days ahead
                  </label>
                  <input
                    id="plan-days"
                    type="number"
                    min={1}
                    max={28}
                    value={days}
                    onChange={(event) => setDays(Number(event.target.value))}
                    className="h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm focus:border-brand focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="plan-start" className="mb-1.5 block text-sm font-medium text-fg-muted">
                    Start hour
                  </label>
                  <input
                    id="plan-start"
                    type="number"
                    min={0}
                    max={23}
                    value={dayStartHour}
                    onChange={(event) => setDayStartHour(Number(event.target.value))}
                    className="h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm focus:border-brand focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="plan-end" className="mb-1.5 block text-sm font-medium text-fg-muted">
                    End hour
                  </label>
                  <input
                    id="plan-end"
                    type="number"
                    min={1}
                    max={24}
                    value={dayEndHour}
                    onChange={(event) => setDayEndHour(Number(event.target.value))}
                    className="h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm focus:border-brand focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          {plan ? (
            <>
              <Button variant="ghost" onClick={() => setPlan(null)}>
                Back
              </Button>
              <Button
                loading={apply.isPending}
                disabled={plan.sessions.length === 0}
                onClick={() =>
                  apply.mutate(
                    {
                      sessions: plan.sessions.map((session) => ({
                        taskId: session.taskId,
                        title: session.title,
                        startAt: session.startAt,
                        endAt: session.endAt,
                        subjectId: session.subjectId ?? null,
                      })),
                    },
                    { onSuccess: onClose },
                  )
                }
              >
                <CalendarCheck className="h-4 w-4" aria-hidden />
                Add to timetable
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                loading={generate.isPending}
                disabled={dayEndHour <= dayStartHour}
                onClick={() =>
                  generate.mutate(
                    {
                      days,
                      dayStartHour,
                      dayEndHour,
                      maxSessionMinutes: 50,
                      minSessionMinutes: 25,
                      includeAdvice: true,
                    },
                    { onSuccess: setPlan },
                  )
                }
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Generate plan
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
