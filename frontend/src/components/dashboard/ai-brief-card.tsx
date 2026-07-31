'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Clock, ListChecks, Sparkles, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useAiBrief } from '@/hooks/use-ai-brief';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The AI "command center": a personalised morning brief generated once a day
 * from the student's real assignments, schedule, streak and remembered facts.
 * It renders nothing when AI is unconfigured (the query returns null).
 */
export function AiBriefCard() {
  const { data: brief, isLoading } = useAiBrief();

  if (isLoading) {
    return (
      <div className="rounded-3xl border border-brand/20 bg-gradient-to-br from-brand/10 via-surface-raised to-surface p-6">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-bright" aria-hidden />
          <span className="text-sm font-medium text-fg-muted">
            Your AI coach is preparing today&apos;s brief…
          </span>
        </div>
        <div className="mt-4 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!brief) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-3xl border border-brand/25 bg-gradient-to-br from-brand/12 via-surface-raised to-surface p-6 sm:p-7"
    >
      <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-brand/20 blur-3xl" aria-hidden />

      <div className="relative">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand/15">
            <Sparkles className="h-4 w-4 text-brand-bright" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold">Your morning brief</p>
            <p className="text-[11px] uppercase tracking-widest text-fg-subtle">AI command center</p>
          </div>
        </div>

        <p className="mt-4 text-[15px] font-medium leading-relaxed">{brief.motivation}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface/60 p-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            <div>
              <p className="text-[11px] uppercase tracking-wide text-fg-subtle">Today&apos;s workload</p>
              <p className="text-sm font-medium">{brief.workload}</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface/60 p-3">
            <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden />
            <div>
              <p className="text-[11px] uppercase tracking-wide text-fg-subtle">Outlook</p>
              <p className="text-sm font-medium">{brief.outlook}</p>
            </div>
          </div>
        </div>

        {brief.priorities.length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
              <ListChecks className="h-3.5 w-3.5 text-brand-bright" aria-hidden />
              Today&apos;s priorities
            </p>
            <ol className="space-y-2">
              {brief.priorities.map((priority, index) => (
                <li key={index} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-brand/12 text-xs font-semibold text-brand-bright">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{priority.title}</p>
                    <p className="text-xs text-fg-muted">{priority.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/25 bg-brand/8 p-3">
          <p className="min-w-0 text-sm">
            <span className="font-medium text-brand-bright">Start here: </span>
            {brief.suggestion}
          </p>
          <Link
            href="/ai"
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand-bright hover:underline"
          >
            Ask your coach
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
