'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { AssignmentRow } from '@/components/assignments/assignment-row';
import { AssignmentFormDialog } from '@/components/assignments/assignment-form-dialog';
import { STATUS_LABEL, PRIORITY_LABEL } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AssignmentRowSkeleton } from '@/components/ui/skeleton';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  useAssignments,
  useBulkUpdateAssignments,
} from '@/hooks/use-assignments';
import { useSubjects } from '@/hooks/use-dashboard';
import { apiErrorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { toQuery, useAssignmentFilters } from '@/stores/assignment-filter-store';
import type { AssignmentStatus, Priority } from '@/types/api';

const STATUSES: AssignmentStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED', 'COMPLETED'];
const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

function AssignmentsView() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight');

  const filters = useAssignmentFilters();
  const { data: subjects } = useSubjects();
  const bulkUpdate = useBulkUpdateAssignments();

  const [showFilters, setShowFilters] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [searchInput, setSearchInput] = useState(filters.search ?? '');
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  // The command palette's "Create Assignment" links to /assignments?new=1.
  const openNew = searchParams.get('new');
  useEffect(() => {
    if (openNew) setShowCreate(true);
  }, [openNew]);

  // Push the debounced value into the store rather than querying on it
  // directly, so the query key stays stable while typing.
  useEffect(() => {
    filters.setSearch(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = useMemo(() => toQuery(filters), [filters]);
  const { data, isLoading, isError, error, isPlaceholderData } = useAssignments(query);

  const activeFilterCount =
    (filters.status?.length ?? 0) +
    (filters.priority?.length ?? 0) +
    (filters.subjectId ? 1 : 0) +
    (filters.includeCompleted ? 1 : 0);

  function toggleIn<T>(list: T[] | undefined, value: T): T[] {
    const current = list ?? [];
    return current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value];
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assignments</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {data ? `${data.pagination.total} total` : 'Loading…'}
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          New assignment
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search assignments…"
            aria-label="Search assignments"
            className="h-10 w-full rounded-xl border border-border bg-surface-raised pl-9 pr-3 text-sm placeholder:text-fg-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
        </div>

        <Button
          variant={showFilters ? 'primary' : 'secondary'}
          onClick={() => setShowFilters((open) => !open)}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          Filters
          {activeFilterCount > 0 ? (
            <span className="ml-0.5 rounded-full bg-white/20 px-1.5 text-xs">
              {activeFilterCount}
            </span>
          ) : null}
        </Button>

        <select
          value={`${filters.sortBy}:${filters.sortOrder}`}
          onChange={(event) => {
            const [sortBy, sortOrder] = event.target.value.split(':');
            filters.setSort(
              sortBy as NonNullable<typeof filters.sortBy>,
              sortOrder as 'asc' | 'desc',
            );
          }}
          aria-label="Sort assignments"
          className="h-10 rounded-xl border border-border bg-surface-raised px-3 text-sm focus:border-brand focus:outline-none"
        >
          <option value="dueAt:asc">Due date (soonest)</option>
          <option value="dueAt:desc">Due date (latest)</option>
          <option value="priority:desc">Priority (highest)</option>
          <option value="createdAt:desc">Recently created</option>
          <option value="title:asc">Title (A–Z)</option>
        </select>
      </div>

      {showFilters ? (
        <Card className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">Status</p>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={filters.status?.includes(status)}
                  onClick={() => filters.setStatus(toggleIn(filters.status, status))}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    filters.status?.includes(status)
                      ? 'border-brand bg-brand/15 text-brand-bright'
                      : 'border-border text-fg-muted hover:border-border-strong',
                  )}
                >
                  {STATUS_LABEL[status]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">Priority</p>
            <div className="flex flex-wrap gap-2">
              {PRIORITIES.map((priority) => (
                <button
                  key={priority}
                  type="button"
                  aria-pressed={filters.priority?.includes(priority)}
                  onClick={() => filters.setPriority(toggleIn(filters.priority, priority))}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    filters.priority?.includes(priority)
                      ? 'border-brand bg-brand/15 text-brand-bright'
                      : 'border-border text-fg-muted hover:border-border-strong',
                  )}
                >
                  {PRIORITY_LABEL[priority]}
                </button>
              ))}
            </div>
          </div>

          {subjects && subjects.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">Subject</p>
              <div className="flex flex-wrap gap-2">
                {subjects.map((subject) => (
                  <button
                    key={subject.id}
                    type="button"
                    aria-pressed={filters.subjectId === subject.id}
                    onClick={() =>
                      filters.setSubject(filters.subjectId === subject.id ? undefined : subject.id)
                    }
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                      filters.subjectId === subject.id
                        ? 'border-brand bg-brand/15 text-brand-bright'
                        : 'border-border text-fg-muted hover:border-border-strong',
                    )}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: subject.color }}
                      aria-hidden
                    />
                    {subject.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between border-t border-border pt-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={filters.includeCompleted}
                onChange={filters.toggleCompleted}
                className="h-4 w-4 rounded border-border bg-surface-raised accent-[var(--color-brand)]"
              />
              Show completed
            </label>

            <Button variant="ghost" size="sm" onClick={filters.reset}>
              <X className="h-4 w-4" aria-hidden />
              Clear filters
            </Button>
          </div>
        </Card>
      ) : null}

      {filters.selectedIds.length > 0 ? (
        <Card className="flex flex-wrap items-center gap-3 border-brand/30 bg-brand/8 py-3">
          <span className="text-sm font-medium">
            {filters.selectedIds.length} selected
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={bulkUpdate.isPending}
              onClick={() =>
                bulkUpdate.mutate(
                  { ids: filters.selectedIds, status: 'COMPLETED' },
                  { onSuccess: filters.clearSelection },
                )
              }
            >
              Mark complete
            </Button>
            <Button size="sm" variant="ghost" onClick={filters.clearSelection}>
              Clear
            </Button>
          </div>
        </Card>
      ) : null}

      {isError ? (
        <Card className="text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-warning" aria-hidden />
          <p className="mt-3 font-medium">Could not load assignments</p>
          <p className="mt-1 text-sm text-fg-muted">{apiErrorMessage(error)}</p>
        </Card>
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <AssignmentRowSkeleton key={index} />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card className="py-14 text-center">
          <Inbox className="mx-auto h-10 w-10 text-fg-subtle" aria-hidden />
          <p className="mt-3 font-medium">
            {activeFilterCount > 0 || filters.search
              ? 'No assignments match these filters'
              : 'No assignments yet'}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">
            {activeFilterCount > 0 || filters.search
              ? 'Try widening your search or clearing a filter.'
              : 'Create your first assignment to start tracking deadlines.'}
          </p>
          {activeFilterCount > 0 || filters.search ? (
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => {
                setSearchInput('');
                filters.reset();
              }}
            >
              Clear filters
            </Button>
          ) : (
            <Button size="sm" className="mt-4" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              New assignment
            </Button>
          )}
        </Card>
      ) : (
        <ul className={cn('space-y-2 transition-opacity', isPlaceholderData && 'opacity-60')}>
          {data.items.map((assignment) => (
            <AssignmentRow
              key={assignment.id}
              assignment={assignment}
              selected={filters.selectedIds.includes(assignment.id)}
              onToggleSelect={filters.toggleSelected}
              highlighted={assignment.id === highlightId}
            />
          ))}
        </ul>
      )}

      {data && data.pagination.totalPages > 1 ? (
        <nav className="flex items-center justify-between" aria-label="Pagination">
          <p className="text-sm text-fg-subtle">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!data.pagination.hasPrevious}
              onClick={() => filters.setPage(data.pagination.page - 1)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!data.pagination.hasNext}
              onClick={() => filters.setPage(data.pagination.page + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </nav>
      ) : null}

      {showCreate ? <AssignmentFormDialog onClose={() => setShowCreate(false)} /> : null}
    </div>
  );
}

export default function AssignmentsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl"><AssignmentRowSkeleton /></div>}>
      <AssignmentsView />
    </Suspense>
  );
}
