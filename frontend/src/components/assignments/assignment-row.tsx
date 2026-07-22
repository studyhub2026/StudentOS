'use client';

import { Check, Paperclip, Repeat, Trash2 } from 'lucide-react';
import { PriorityBadge, StatusBadge } from '@/components/ui/badge';
import { useDeleteAssignment, useUpdateAssignment } from '@/hooks/use-assignments';
import { cn, formatDueDate, formatMinutes } from '@/lib/utils';
import type { Assignment } from '@/types/api';

interface AssignmentRowProps {
  assignment: Assignment;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  highlighted?: boolean;
}

export function AssignmentRow({
  assignment,
  selected,
  onToggleSelect,
  highlighted,
}: AssignmentRowProps) {
  const update = useUpdateAssignment();
  const remove = useDeleteAssignment();

  const done = assignment.status === 'COMPLETED' || assignment.status === 'SUBMITTED';
  const due = formatDueDate(assignment.dueAt);

  return (
    <li
      className={cn(
        'group flex items-start gap-3 rounded-xl border bg-surface p-4 transition-all',
        highlighted ? 'border-brand/50 shadow-[var(--shadow-glow)]' : 'border-border',
        'hover:border-border-strong',
        done && 'opacity-60',
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(assignment.id)}
        aria-label={`Select ${assignment.title}`}
        className="mt-1 h-4 w-4 shrink-0 rounded border-border bg-surface-raised accent-[var(--color-brand)]"
      />

      <button
        type="button"
        aria-label={done ? `Mark ${assignment.title} as to do` : `Mark ${assignment.title} complete`}
        aria-pressed={done}
        onClick={() =>
          update.mutate({
            id: assignment.id,
            body: { status: done ? 'TODO' : 'COMPLETED' },
          })
        }
        className={cn(
          'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors',
          done
            ? 'border-success bg-success text-white'
            : 'border-border-strong hover:border-brand',
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn('font-medium', done && 'line-through')}>{assignment.title}</p>

          {assignment.recurrence ? (
            <Repeat className="h-3.5 w-3.5 text-fg-subtle" aria-label="Recurring" />
          ) : null}
          {assignment.attachments.length > 0 ? (
            <span className="flex items-center gap-1 text-xs text-fg-subtle">
              <Paperclip className="h-3 w-3" aria-hidden />
              {assignment.attachments.length}
            </span>
          ) : null}
        </div>

        {assignment.description ? (
          <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{assignment.description}</p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
          {assignment.subject ? (
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: assignment.subject.color }}
                aria-hidden
              />
              {assignment.subject.name}
            </span>
          ) : null}

          <span className={cn(due.overdue && 'font-medium text-danger', due.urgent && !due.overdue && 'text-warning')}>
            {due.label}
          </span>

          {assignment.estimatedMinutes ? (
            <span>Est. {formatMinutes(assignment.estimatedMinutes)}</span>
          ) : null}

          {assignment.labels.map((label) => (
            <span key={label} className="rounded-md bg-surface-raised px-1.5 py-0.5">
              {label}
            </span>
          ))}
        </div>

        {assignment.progress > 0 && !done ? (
          <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-surface-raised">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand to-accent transition-all"
              style={{ width: `${assignment.progress}%` }}
            />
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="hidden sm:flex sm:items-center sm:gap-2">
          <PriorityBadge priority={assignment.priority} />
          <StatusBadge status={assignment.status} />
        </div>

        <button
          type="button"
          aria-label={`Delete ${assignment.title}`}
          onClick={() => remove.mutate(assignment.id)}
          disabled={remove.isPending}
          className="rounded-lg p-1.5 text-fg-subtle opacity-0 transition-all hover:bg-danger/12 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </li>
  );
}
