'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { STATUS_LABEL, PRIORITY_LABEL } from '@/components/ui/badge';
import { useCreateAssignment, useUpdateAssignment } from '@/hooks/use-assignments';
import { useSubjects } from '@/hooks/use-dashboard';
import { cn } from '@/lib/utils';
import type { Assignment, AssignmentStatus, CreateAssignmentBody, Priority } from '@/types/api';

const STATUSES: AssignmentStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED', 'COMPLETED'];
const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

interface AssignmentFormDialogProps {
  /** When set, the dialog edits this assignment instead of creating a new one. */
  assignment?: Assignment;
  onClose: () => void;
}

/** Converts an ISO string to the value a `datetime-local` input expects. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export function AssignmentFormDialog({ assignment, onClose }: AssignmentFormDialogProps) {
  const isEdit = Boolean(assignment);
  const { data: subjects } = useSubjects();
  const create = useCreateAssignment();
  const update = useUpdateAssignment();
  const pending = create.isPending || update.isPending;

  const [title, setTitle] = useState(assignment?.title ?? '');
  const [description, setDescription] = useState(assignment?.description ?? '');
  const [subjectId, setSubjectId] = useState(assignment?.subjectId ?? '');
  const [priority, setPriority] = useState<Priority>(assignment?.priority ?? 'MEDIUM');
  const [status, setStatus] = useState<AssignmentStatus>(assignment?.status ?? 'TODO');
  const [dueAt, setDueAt] = useState(toLocalInput(assignment?.dueAt));
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    assignment?.estimatedMinutes ? String(assignment.estimatedMinutes) : '',
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError('Give the assignment a title.');
      return;
    }

    const body: CreateAssignmentBody = {
      title: title.trim(),
      description: description.trim() || undefined,
      subjectId: subjectId || null,
      priority,
      status,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
    };

    if (isEdit && assignment) {
      update.mutate({ id: assignment.id, body }, { onSuccess: onClose });
    } else {
      create.mutate(body, { onSuccess: onClose });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit assignment' : 'New assignment'}
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="glass relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl p-6">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <CalendarDays className="h-4 w-4 text-brand" aria-hidden />
            {isEdit ? 'Edit assignment' : 'New assignment'}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-raised hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Calculus problem set 4"
            error={error ?? undefined}
            autoFocus
            maxLength={200}
          />

          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg-muted" htmlFor="assignment-desc">
              Description
            </label>
            <textarea
              id="assignment-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional details…"
              rows={3}
              className="w-full resize-none rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm placeholder:text-fg-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-fg-muted" htmlFor="assignment-subject">
                Subject
              </label>
              <select
                id="assignment-subject"
                value={subjectId}
                onChange={(event) => setSubjectId(event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm focus:border-brand focus:outline-none"
              >
                <option value="">None</option>
                {subjects?.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-fg-muted" htmlFor="assignment-due">
                Due date
              </label>
              <input
                id="assignment-due"
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm focus:border-brand focus:outline-none"
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">Priority</p>
            <div className="flex flex-wrap gap-2">
              {PRIORITIES.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={priority === value}
                  onClick={() => setPriority(value)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    priority === value
                      ? 'border-brand bg-brand/15 text-brand-bright'
                      : 'border-border text-fg-muted hover:border-border-strong',
                  )}
                >
                  {PRIORITY_LABEL[value]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">Status</p>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as AssignmentStatus)}
                aria-label="Status"
                className="h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm focus:border-brand focus:outline-none"
              >
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {STATUS_LABEL[value]}
                  </option>
                ))}
              </select>
            </div>

            <Input
              label="Estimated minutes"
              type="number"
              min={0}
              max={100000}
              value={estimatedMinutes}
              onChange={(event) => setEstimatedMinutes(event.target.value)}
              placeholder="e.g. 90"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {isEdit ? 'Save changes' : 'Create assignment'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
