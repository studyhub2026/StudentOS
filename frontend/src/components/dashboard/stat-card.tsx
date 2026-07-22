import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  hint?: string;
  tone?: 'brand' | 'accent' | 'teal' | 'success' | 'warning' | 'danger';
}

const TONES = {
  brand: 'text-brand-bright border-brand/25 bg-brand/12',
  accent: 'text-accent border-accent/25 bg-accent/12',
  teal: 'text-teal border-teal/25 bg-teal/12',
  success: 'text-success border-success/25 bg-success/12',
  warning: 'text-warning border-warning/25 bg-warning/12',
  danger: 'text-danger border-danger/25 bg-danger/12',
} as const;

export function StatCard({ label, value, icon: Icon, hint, tone = 'brand' }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg border', TONES[tone])}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>

      <p className="mt-3 text-3xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-fg-subtle">{hint}</p> : null}
    </div>
  );
}
