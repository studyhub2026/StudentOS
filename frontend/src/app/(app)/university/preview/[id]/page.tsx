'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  DollarSign,
  Eye,
  FileText,
  HardDrive,
  Loader2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useApprovePreview,
  useCancelPreview,
  usePreview,
} from '@/hooks/use-university';
import { apiErrorMessage } from '@/lib/api-client';
import type { EntityPlan, SyncPlan } from '@/types/api';

const ENTITY_LABELS: Record<keyof SyncPlan, string> = {
  courses: 'Courses',
  assignments: 'Assignments',
  exams: 'Exams',
  announcements: 'Announcements',
  grades: 'Grades',
  files: 'Files',
};

function EntitySection({
  label,
  plan,
}: {
  label: string;
  plan: EntityPlan;
}) {
  const total =
    plan.new.length + plan.updated.length + plan.deleted.length + plan.duplicate.length;
  if (total === 0) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{label}</CardTitle>
        <div className="flex gap-2 text-xs">
          {plan.new.length > 0 && <Badge tone="success">+{plan.new.length} new</Badge>}
          {plan.updated.length > 0 && (
            <Badge tone="warning">{plan.updated.length} updated</Badge>
          )}
          {plan.deleted.length > 0 && (
            <Badge tone="danger">{plan.deleted.length} deleted</Badge>
          )}
          {plan.duplicate.length > 0 && (
            <Badge tone="neutral">{plan.duplicate.length} unchanged</Badge>
          )}
        </div>
      </CardHeader>
      <div className="px-4 pb-4">
        {plan.new.length > 0 && (
          <SampleList label="New" items={plan.new} tone="text-success" />
        )}
        {plan.updated.length > 0 && (
          <SampleList label="Updated" items={plan.updated} tone="text-warning" />
        )}
        {plan.deleted.length > 0 && (
          <SampleList label="Deleted" items={plan.deleted} tone="text-danger" />
        )}
      </div>
    </Card>
  );
}

function SampleList({
  label,
  items,
  tone,
}: {
  label: string;
  items: { externalId: string; label: string; courseName?: string }[];
  tone: string;
}) {
  return (
    <div className="mt-2 first:mt-0">
      <p className={`text-xs font-medium ${tone}`}>{label}</p>
      <ul className="mt-1 space-y-0.5 text-sm">
        {items.slice(0, 20).map((s) => (
          <li key={s.externalId} className="flex items-center gap-2 text-fg-muted">
            <span className="truncate">{s.label}</span>
            {s.courseName && (
              <span className="truncate text-xs text-fg-subtle">· {s.courseName}</span>
            )}
          </li>
        ))}
        {items.length > 20 && (
          <li className="text-xs italic text-fg-subtle">
            …and {items.length - 20} more
          </li>
        )}
      </ul>
    </div>
  );
}

export default function PreviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const q = usePreview(params?.id ?? null);
  const approve = useApprovePreview();
  const cancel = useCancelPreview();
  const [acting, setActing] = useState<'approve' | 'cancel' | null>(null);

  const handleApprove = async () => {
    if (!params?.id) return;
    setActing('approve');
    try {
      await approve.mutateAsync(params.id);
      toast.success('Sync approved — running now.');
      router.push('/university');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setActing(null);
    }
  };

  const handleCancel = async () => {
    if (!params?.id) return;
    setActing('cancel');
    try {
      await cancel.mutateAsync(params.id);
      toast.success('Preview cancelled');
      router.push('/university');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setActing(null);
    }
  };

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
        <div className="mt-2 flex items-center gap-2">
          <Eye className="h-5 w-5 text-brand-bright" />
          <h1 className="text-2xl font-semibold tracking-tight">Sync preview</h1>
        </div>
        <p className="mt-1 text-sm text-fg-muted">
          A dry-run pass over the remote data. Nothing has been written yet — approve to run the
          real sync, or cancel to discard this plan.
        </p>
      </header>

      {q.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : q.data ? (
        <>
          {/* Header status */}
          <Card>
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardTitle className="text-base">
                  {q.data.connection.displayName}
                </CardTitle>
                <p className="mt-1 text-xs text-fg-muted">
                  Created {new Date(q.data.createdAt).toLocaleString()} · expires{' '}
                  {new Date(q.data.expiresAt).toLocaleString()}
                </p>
              </div>
              <Badge
                tone={
                  q.data.status === 'PENDING'
                    ? 'warning'
                    : q.data.status === 'APPROVED'
                      ? 'success'
                      : q.data.status === 'CANCELLED'
                        ? 'neutral'
                        : 'danger'
                }
              >
                {q.data.status.toLowerCase()}
              </Badge>
            </CardHeader>
            <div className="grid gap-3 px-4 pb-4 sm:grid-cols-4">
              <EstimateTile
                label="Records"
                value={q.data.estimates.records.toString()}
                icon={FileText}
              />
              <EstimateTile
                label="Est. duration"
                value={
                  q.data.estimates.durationSec < 60
                    ? `${q.data.estimates.durationSec}s`
                    : `${Math.round(q.data.estimates.durationSec / 60)}m`
                }
                icon={Clock}
              />
              <EstimateTile
                label="Est. AI cost"
                value={`$${q.data.estimates.aiCostUsd.toFixed(4)}`}
                icon={DollarSign}
              />
              <EstimateTile
                label="Est. storage"
                value={`${q.data.estimates.storageMb.toFixed(2)} MB`}
                icon={HardDrive}
              />
            </div>
          </Card>

          {/* Per-entity plans */}
          {(Object.keys(q.data.plan) as (keyof SyncPlan)[]).map((k) => (
            <EntitySection key={k} label={ENTITY_LABELS[k]} plan={q.data.plan[k]} />
          ))}

          {q.data.estimates.records === 0 && (
            <Card className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="mb-3 h-10 w-10 text-success" />
              <p className="font-medium">Nothing to import</p>
              <p className="mt-1 text-sm text-fg-muted">
                Everything on the remote side is already in sync.
              </p>
            </Card>
          )}

          {/* Actions */}
          {q.data.status === 'PENDING' ? (
            <div className="sticky bottom-4 z-10 flex justify-end gap-2 rounded-xl border border-border bg-surface p-3 shadow-lg">
              <Button
                variant="ghost"
                onClick={handleCancel}
                disabled={acting !== null}
              >
                {acting === 'cancel' ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <X className="mr-1 h-4 w-4" />
                )}
                Cancel
              </Button>
              <Button
                onClick={handleApprove}
                disabled={acting !== null || q.data.estimates.records === 0}
              >
                {acting === 'approve' ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-1 h-4 w-4" />
                )}
                Approve &amp; sync
              </Button>
            </div>
          ) : (
            <Card className="flex items-center gap-3 p-4">
              <AlertTriangle className="h-4 w-4 text-fg-muted" />
              <p className="text-sm text-fg-muted">
                This preview is {q.data.status.toLowerCase()} and can no longer be approved.
                Return to the University page to request a new one.
              </p>
            </Card>
          )}
        </>
      ) : (
        <p className="text-sm text-danger">Could not load preview.</p>
      )}
    </div>
  );
}

function EstimateTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Cloud;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised/50 px-3 py-2">
      <div className="rounded-md bg-brand/12 p-1.5 text-brand-bright">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div>
        <p className="text-sm font-semibold tabular-nums">{value}</p>
        <p className="text-[10px] uppercase tracking-wide text-fg-subtle">{label}</p>
      </div>
    </div>
  );
}
