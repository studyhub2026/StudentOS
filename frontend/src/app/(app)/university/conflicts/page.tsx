'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Cloud,
  GitMerge,
  History,
  Loader2,
  RotateCcw,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useConflicts,
  useResolveConflict,
  useUndoConflict,
} from '@/hooks/use-university';
import { apiErrorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { Conflict, ResolutionAction } from '@/types/api';

/**
 * Formats a raw field value for the side-by-side conflict view. Handles the
 * types we actually emit into localData/remoteData: strings, numbers, dates,
 * booleans, and nulls. Anything else falls through to JSON.stringify.
 */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    // Detect ISO-8601 timestamps.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
      return new Date(v).toLocaleString();
    }
    return v;
  }
  return JSON.stringify(v);
}

type PickerState = Record<string, 'LOCAL' | 'REMOTE'>;

function ConflictCard({ conflict }: { conflict: Conflict }) {
  const resolve = useResolveConflict();
  const undo = useUndoConflict();
  const [showMerge, setShowMerge] = useState(false);

  const fields = useMemo(() => {
    const keys = new Set<string>([
      ...Object.keys(conflict.localData ?? {}),
      ...Object.keys(conflict.remoteData ?? {}),
    ]);
    // Skip internal/uninteresting fields.
    for (const skip of ['updatedAt', 'createdAt', 'status']) keys.delete(skip);
    return [...keys].sort();
  }, [conflict.localData, conflict.remoteData]);

  const [picker, setPicker] = useState<PickerState>(() => {
    const initial: PickerState = {};
    for (const k of fields) {
      // Default per-field pick: LOCAL where fields differ (users usually want
      // to keep their edits), REMOTE where they don't.
      const l = conflict.localData?.[k];
      const r = conflict.remoteData?.[k];
      initial[k] = JSON.stringify(l) === JSON.stringify(r) ? 'REMOTE' : 'LOCAL';
    }
    return initial;
  });

  const runResolve = async (action: ResolutionAction) => {
    try {
      if (action === 'MERGE') {
        const mergedData: Record<string, unknown> = {};
        for (const k of fields) {
          mergedData[k] =
            picker[k] === 'LOCAL' ? conflict.localData?.[k] : conflict.remoteData?.[k];
        }
        await resolve.mutateAsync({ id: conflict.id, action, mergedData });
      } else {
        await resolve.mutateAsync({ id: conflict.id, action });
      }
      toast.success(`Resolved: ${action.replace('_', ' ').toLowerCase()}`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const runUndo = async () => {
    try {
      await undo.mutateAsync(conflict.id);
      toast.success('Undone — conflict is pending again');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const busy = resolve.isPending || undo.isPending;
  const isPending = conflict.status === 'PENDING';

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">
            <span className="capitalize">{conflict.entityType}</span> from{' '}
            {conflict.connection.displayName}
          </CardTitle>
          <p className="mt-1 text-xs text-fg-muted">
            Detected {new Date(conflict.detectedAt).toLocaleString()}
          </p>
        </div>
        <Badge tone={isPending ? 'warning' : conflict.status === 'RESOLVED' ? 'success' : 'neutral'}>
          {conflict.status.toLowerCase()}
        </Badge>
      </CardHeader>

      <div className="space-y-3 px-4 pb-4">
        {/* Side-by-side diff */}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-raised/40 text-left text-xs text-fg-muted">
                <th className="px-3 py-2">Field</th>
                <th className="px-3 py-2">Local (your edit)</th>
                <th className="px-3 py-2">Remote (from LMS)</th>
                {showMerge && <th className="px-3 py-2">Merge pick</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {fields.map((k) => {
                const l = formatValue(conflict.localData?.[k]);
                const r = formatValue(conflict.remoteData?.[k]);
                const same = l === r;
                return (
                  <tr key={k} className={same ? 'text-fg-subtle' : ''}>
                    <td className="px-3 py-2 font-mono text-xs">{k}</td>
                    <td className={cn('px-3 py-2', !same && 'bg-brand/6')}>{l}</td>
                    <td className={cn('px-3 py-2', !same && 'bg-teal/6')}>{r}</td>
                    {showMerge && (
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <label className="flex items-center gap-1 text-xs">
                            <input
                              type="radio"
                              className="accent-brand"
                              checked={picker[k] === 'LOCAL'}
                              onChange={() => setPicker({ ...picker, [k]: 'LOCAL' })}
                            />
                            Local
                          </label>
                          <label className="flex items-center gap-1 text-xs">
                            <input
                              type="radio"
                              className="accent-teal"
                              checked={picker[k] === 'REMOTE'}
                              onChange={() => setPicker({ ...picker, [k]: 'REMOTE' })}
                            />
                            Remote
                          </label>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        {isPending ? (
          <div className="flex flex-wrap gap-2">
            {!showMerge ? (
              <>
                <Button size="sm" onClick={() => runResolve('KEEP_LOCAL')} disabled={busy}>
                  <Check className="mr-1 h-4 w-4" />
                  Keep local
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => runResolve('KEEP_REMOTE')}
                  disabled={busy}
                >
                  <Cloud className="mr-1 h-4 w-4" />
                  Keep remote
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowMerge(true)}
                  disabled={busy}
                >
                  <GitMerge className="mr-1 h-4 w-4" />
                  Merge…
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => runResolve('IGNORE')}
                  disabled={busy}
                >
                  <X className="mr-1 h-4 w-4" />
                  Ignore
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => runResolve('MERGE')} disabled={busy}>
                  {busy ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-1 h-4 w-4" />
                  )}
                  Apply merge
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowMerge(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={runUndo} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-1 h-4 w-4" />
              )}
              Undo resolution
            </Button>
          </div>
        )}

        {/* Resolution history */}
        {conflict.resolutions.length > 0 && (
          <div className="rounded-lg border border-border bg-surface-raised/40 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
              <History className="h-3 w-3" />
              Resolution history
            </div>
            <ul className="mt-2 space-y-1 text-xs">
              {conflict.resolutions.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-fg-muted">
                  <span className="tabular-nums">
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                  <Badge tone={r.action === 'UNDONE' ? 'neutral' : 'success'}>
                    {r.action.toLowerCase().replace('_', ' ')}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function ConflictsPage() {
  const [tab, setTab] = useState<'PENDING' | 'RESOLVED' | 'IGNORED' | 'ALL'>('PENDING');
  const q = useConflicts(tab);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <Link
          href="/university"
          className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to University Sync
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Conflict Resolution</h1>
        <p className="mt-1 text-sm text-fg-muted">
          When a locally-edited synced record diverges from its remote copy, we pause the
          overwrite and ask you what to do. Actions are reversible via the audit history.
        </p>
      </header>

      <div className="flex gap-2 border-b border-border">
        {(['PENDING', 'RESOLVED', 'IGNORED', 'ALL'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm transition-colors',
              tab === t
                ? 'border-brand text-fg'
                : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {t.toLowerCase()}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : q.data?.length ? (
        <div className="space-y-4">
          {q.data.map((c) => (
            <ConflictCard key={c.id} conflict={c} />
          ))}
        </div>
      ) : (
        <Card className="flex flex-col items-center justify-center py-12 text-center">
          {tab === 'PENDING' ? (
            <>
              <CheckCircle2 className="mb-3 h-10 w-10 text-success" />
              <p className="font-medium">All clear — no pending conflicts.</p>
              <p className="mt-1 text-sm text-fg-muted">
                We&apos;ll flag anything that needs your attention here.
              </p>
            </>
          ) : (
            <>
              <AlertTriangle className="mb-3 h-10 w-10 text-fg-subtle" />
              <p className="font-medium">No {tab.toLowerCase()} conflicts to show.</p>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
