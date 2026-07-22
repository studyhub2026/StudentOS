import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import type { AssignmentStatus, Priority } from '@/types/api';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-surface-raised text-fg-muted',
        brand: 'border-brand/30 bg-brand/12 text-brand-bright',
        success: 'border-success/30 bg-success/12 text-success',
        warning: 'border-warning/30 bg-warning/12 text-warning',
        danger: 'border-danger/30 bg-danger/12 text-danger',
        info: 'border-accent/30 bg-accent/12 text-accent',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const STATUS_TONE: Record<AssignmentStatus, NonNullable<BadgeProps['tone']>> = {
  TODO: 'neutral',
  IN_PROGRESS: 'info',
  BLOCKED: 'danger',
  SUBMITTED: 'brand',
  COMPLETED: 'success',
  ARCHIVED: 'neutral',
};

const STATUS_LABEL: Record<AssignmentStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  BLOCKED: 'Blocked',
  SUBMITTED: 'Submitted',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

export function StatusBadge({ status }: { status: AssignmentStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

const PRIORITY_TONE: Record<Priority, NonNullable<BadgeProps['tone']>> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  URGENT: 'danger',
};

const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
}

export { STATUS_LABEL, PRIORITY_LABEL };
