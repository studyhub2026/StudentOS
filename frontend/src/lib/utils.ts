import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges class names, resolving conflicting Tailwind utilities correctly. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * Relative due-date label. Returns an `overdue` flag so callers can style the
 * urgency rather than parsing the string.
 */
export function formatDueDate(due: string | Date | null): {
  label: string;
  overdue: boolean;
  urgent: boolean;
} {
  if (!due) return { label: 'No due date', overdue: false, urgent: false };

  const date = typeof due === 'string' ? new Date(due) : due;
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

  if (diffMs < 0) {
    const overdueDays = Math.abs(diffDays);
    return {
      label:
        overdueDays === 0
          ? 'Overdue today'
          : `Overdue by ${overdueDays} day${overdueDays === 1 ? '' : 's'}`,
      overdue: true,
      urgent: true,
    };
  }

  if (diffDays === 0) return { label: 'Due today', overdue: false, urgent: true };
  if (diffDays === 1) return { label: 'Due tomorrow', overdue: false, urgent: true };
  if (diffDays < 7) return { label: `Due in ${diffDays} days`, overdue: false, urgent: false };

  return {
    label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    overdue: false,
    urgent: false,
  };
}

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
