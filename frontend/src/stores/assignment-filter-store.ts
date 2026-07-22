'use client';

import { create } from 'zustand';
import type { AssignmentFilters, AssignmentStatus, Priority } from '@/types/api';

/**
 * Assignment list UI state. Kept out of React Query so filter changes don't
 * remount the list, and out of the URL so rapid typing doesn't spam history.
 */
interface FilterState extends AssignmentFilters {
  view: 'list' | 'board';
  selectedIds: string[];

  setSearch: (search: string) => void;
  setStatus: (status: AssignmentStatus[]) => void;
  setPriority: (priority: Priority[]) => void;
  setSubject: (subjectId: string | undefined) => void;
  setLabels: (labels: string[]) => void;
  setSort: (sortBy: AssignmentFilters['sortBy'], sortOrder: 'asc' | 'desc') => void;
  setPage: (page: number) => void;
  setView: (view: 'list' | 'board') => void;
  toggleCompleted: () => void;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;
  reset: () => void;
}

const INITIAL: AssignmentFilters & { view: 'list' | 'board'; selectedIds: string[] } = {
  page: 1,
  limit: 20,
  sortBy: 'dueAt',
  sortOrder: 'asc',
  status: [],
  priority: [],
  labels: [],
  search: '',
  includeCompleted: false,
  includeArchived: false,
  view: 'list',
  selectedIds: [],
};

export const useAssignmentFilters = create<FilterState>((set) => ({
  ...INITIAL,

  // Any filter change resets to page 1 — staying on page 4 of a now-shorter
  // result set would show an empty list.
  setSearch: (search) => set({ search, page: 1 }),
  setStatus: (status) => set({ status, page: 1 }),
  setPriority: (priority) => set({ priority, page: 1 }),
  setSubject: (subjectId) => set({ subjectId, page: 1 }),
  setLabels: (labels) => set({ labels, page: 1 }),
  setSort: (sortBy, sortOrder) => set({ sortBy, sortOrder, page: 1 }),
  setPage: (page) => set({ page }),
  setView: (view) => set({ view }),

  toggleCompleted: () =>
    set((state) => ({ includeCompleted: !state.includeCompleted, page: 1 })),

  toggleSelected: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((entry) => entry !== id)
        : [...state.selectedIds, id],
    })),

  clearSelection: () => set({ selectedIds: [] }),
  reset: () => set(INITIAL),
}));

/** Strips UI-only fields and empty values before sending to the API. */
export function toQuery(state: FilterState): AssignmentFilters {
  const query: AssignmentFilters = {
    page: state.page,
    limit: state.limit,
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
    includeCompleted: state.includeCompleted,
    includeArchived: state.includeArchived,
  };

  if (state.search) query.search = state.search;
  if (state.status?.length) query.status = state.status;
  if (state.priority?.length) query.priority = state.priority;
  if (state.subjectId) query.subjectId = state.subjectId;
  if (state.labels?.length) query.labels = state.labels;

  return query;
}
