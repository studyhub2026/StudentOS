'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Cloud,
  CloudOff,
  Eye,
  FileText,
  GitMerge,
  GraduationCap,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
  Star,
  Stethoscope,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { apiErrorMessage } from '@/lib/api-client';
import { useT } from '@/lib/i18n/provider';
import {
  useConflicts,
  useCreateConnection,
  useCreatePreview,
  useDeleteConnection,
  useLmsConnections,
  useLmsProviders,
  useQueueStatus,
  useStartOAuth,
  useSyncLogs,
  useTriggerSync,
  useUniversityDashboard,
} from '@/hooks/use-university';
import type {
  Conflict,
  CreateConnectionBody,
  LmsConnection,
  LmsProviderPublicMeta,
} from '@/types/api';

/**
 * The Advanced Scheduler options — must match SYNC_INTERVAL_MINUTES on the
 * server. Kept as a plain constant here so the dropdown renders instantly
 * without an extra round-trip.
 */
const SYNC_INTERVAL_OPTIONS = [
  { value: 5, label: 'Every 5 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Daily' },
  { value: 10080, label: 'Weekly' },
];

const STATUS_TONE: Record<string, { tone: string; icon: typeof Wifi }> = {
  CONNECTED: { tone: 'text-success', icon: Wifi },
  DISCONNECTED: { tone: 'text-fg-muted', icon: WifiOff },
  ERROR: { tone: 'text-danger', icon: AlertTriangle },
  SYNCING: { tone: 'text-brand-bright', icon: RefreshCw },
};

const PROVIDER_STATUS_TONE = {
  LIVE: 'success',
  IN_DEVELOPMENT: 'warning',
  PLANNED: 'neutral',
  UNSUPPORTED: 'danger',
} as const;

const PROVIDER_STATUS_LABEL: Record<LmsProviderPublicMeta['status'], string> = {
  LIVE: 'Live',
  IN_DEVELOPMENT: 'In development',
  PLANNED: 'Planned',
  UNSUPPORTED: 'Unsupported',
};

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | string;
  icon: typeof BookOpen;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised/50 px-4 py-3">
      <div className={cn('rounded-lg p-2', tone)}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-fg-muted">{label}</p>
      </div>
    </div>
  );
}

function ConnectionCard({
  conn,
  onSync,
  onPreview,
  onDelete,
  isSyncing,
  isPreviewing,
}: {
  conn: LmsConnection;
  onSync: () => void;
  onPreview: () => void;
  onDelete: () => void;
  isSyncing: boolean;
  isPreviewing: boolean;
}) {
  const st = STATUS_TONE[conn.status] ?? STATUS_TONE.DISCONNECTED;
  const StatusIcon = st.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-xl border border-border bg-surface-raised/50 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusIcon
              className={cn(
                'h-4 w-4 shrink-0',
                st.tone,
                conn.status === 'SYNCING' && 'animate-spin',
              )}
            />
            <h3 className="truncate font-medium">{conn.displayName}</h3>
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">
            {conn.provider.replace('_', ' ')} · adapter {conn.adapterVersion ?? '1.0.0'}
          </p>
          <p className="mt-0.5 truncate text-xs text-fg-subtle">{conn.portalUrl}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Preview next sync (dry run)"
            onClick={onPreview}
            disabled={isPreviewing || isSyncing || conn.status === 'SYNCING'}
          >
            <Eye className={cn('h-4 w-4', isPreviewing && 'animate-pulse')} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Sync now"
            onClick={onSync}
            disabled={isSyncing || conn.status === 'SYNCING'}
          >
            <RefreshCw className={cn('h-4 w-4', isSyncing && 'animate-spin')} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-danger"
            title="Disconnect"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Badge tone="neutral">{conn._count.courses} courses</Badge>
        <Badge tone="neutral">{conn._count.assignments} assignments</Badge>
        <Badge tone="neutral">{conn._count.exams} exams</Badge>
        <Badge tone="neutral">{conn._count.files} files</Badge>
        {conn._count.conflicts > 0 && (
          <Badge tone="danger">{conn._count.conflicts} conflicts</Badge>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3 text-xs text-fg-subtle">
        {conn.lastSyncAt ? (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Last sync: {new Date(conn.lastSyncAt).toLocaleString()}
          </span>
        ) : (
          <span>Never synced</span>
        )}
        {conn.autoSync && (
          <span className="flex items-center gap-1">
            <RefreshCw className="h-3 w-3" />
            Every {conn.syncInterval}m
          </span>
        )}
      </div>

      {conn.statusDetail && <p className="mt-2 text-xs text-danger">{conn.statusDetail}</p>}
    </motion.div>
  );
}

function AddConnectionForm({
  onClose,
  providers,
}: {
  onClose: () => void;
  providers: LmsProviderPublicMeta[];
}) {
  const create = useCreateConnection();
  const startOAuth = useStartOAuth();
  const defaultProvider = providers.find((p) => p.ready)?.id ?? providers[0]?.id ?? 'CANVAS';
  const [form, setForm] = useState<CreateConnectionBody>({
    provider: defaultProvider,
    displayName: '',
    portalUrl: '',
    autoSync: true,
    syncInterval: 60,
    importGrades: true,
    importCalendar: true,
    importFiles: true,
  });

  const selected = providers.find((p) => p.id === form.provider);
  const useOAuth = selected?.authMode === 'oauth' && selected.ready;
  const useToken = selected?.authMode === 'token' && selected.ready;
  const notReady = selected && !selected.ready;

  const handleOAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    if (!form.displayName || !form.portalUrl) {
      toast.error('Enter a display name and portal URL first.');
      return;
    }
    try {
      const result = await startOAuth.mutateAsync({
        provider: selected.slug as 'canvas',
        portalUrl: form.portalUrl,
        displayName: form.displayName,
      });
      window.location.href = result.authorizeUrl;
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await create.mutateAsync(form);
      toast.success('Connection added');
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <Card className="border-brand/30">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Add LMS Connection</CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <form onSubmit={handleSubmit} className="space-y-3 px-4 pb-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">LMS Provider</label>
            <select
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40"
              value={form.provider}
              onChange={(e) =>
                setForm({ ...form, provider: e.target.value as CreateConnectionBody['provider'] })
              }
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.displayName}
                  {!p.ready ? ` — ${PROVIDER_STATUS_LABEL[p.status].toLowerCase()}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Display Name</label>
            <input
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40"
              placeholder="My University"
              required
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Portal URL</label>
            <input
              type="url"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40"
              placeholder="https://lms.university.edu"
              required
              value={form.portalUrl}
              onChange={(e) => setForm({ ...form, portalUrl: e.target.value })}
            />
          </div>

          {useToken && (
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">
                Access Token
              </label>
              <input
                type="password"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40"
                placeholder="Paste the token from your provider portal"
                value={form.apiKey ?? ''}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value || undefined })}
              />
              <p className="mt-1 text-[10px] text-fg-subtle">
                Tokens are encrypted at rest and never stored in plain text.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-brand"
                checked={form.autoSync}
                onChange={(e) => setForm({ ...form, autoSync: e.target.checked })}
              />
              Auto Sync
            </label>
            {selected?.capabilities.includes('GRADES') && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={form.importGrades}
                  onChange={(e) => setForm({ ...form, importGrades: e.target.checked })}
                />
                Import Grades
              </label>
            )}
            {selected?.capabilities.includes('CALENDAR') && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={form.importCalendar}
                  onChange={(e) => setForm({ ...form, importCalendar: e.target.checked })}
                />
                Import Calendar
              </label>
            )}
            {selected?.capabilities.includes('FILES') && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={form.importFiles}
                  onChange={(e) => setForm({ ...form, importFiles: e.target.checked })}
                />
                Import Files
              </label>
            )}
          </div>

          {form.autoSync && (
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">Sync Interval</label>
              <select
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40"
                value={form.syncInterval}
                onChange={(e) =>
                  setForm({ ...form, syncInterval: Number(e.target.value) })
                }
              >
                {SYNC_INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {useOAuth && (
            <div className="rounded-lg border border-brand/30 bg-brand/6 p-3 text-xs text-fg-muted">
              <p className="font-medium text-fg">Secure OAuth sign-in</p>
              <p className="mt-1">
                You&apos;ll be redirected to {selected?.displayName} to authorize OmnelOS. Your
                password never leaves the university portal.
              </p>
            </div>
          )}

          {useToken && selected?.id === 'MOODLE' && (
            <div className="rounded-lg border border-brand/30 bg-brand/6 p-3 text-xs text-fg-muted">
              <p className="font-medium text-fg">How to get your Moodle token</p>
              <ol className="mt-2 list-decimal space-y-1 pl-4">
                <li>Sign in to your Moodle site.</li>
                <li>
                  Open{' '}
                  <span className="font-medium">
                    Preferences → User account → Security keys
                  </span>
                  .
                </li>
                <li>
                  Copy the token for{' '}
                  <span className="font-medium">Moodle mobile web service</span> (create one if
                  none exists).
                </li>
                <li>
                  Paste it into the field above and click{' '}
                  <span className="font-medium">Add Connection</span>.
                </li>
              </ol>
            </div>
          )}

          {notReady && (
            <div className="rounded-lg border border-warning/30 bg-warning/8 p-3 text-xs text-fg-muted">
              <p className="font-medium text-fg">
                {selected?.displayName} is {PROVIDER_STATUS_LABEL[selected!.status].toLowerCase()}
              </p>
              <p className="mt-1">{selected?.readyReason ?? selected?.notes}</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            {useOAuth ? (
              <Button
                type="button"
                size="sm"
                onClick={handleOAuth}
                disabled={startOAuth.isPending}
              >
                {startOAuth.isPending ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    Redirecting…
                  </>
                ) : (
                  <>Connect via OAuth</>
                )}
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={create.isPending || Boolean(notReady)}>
                {create.isPending ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    Adding…
                  </>
                ) : (
                  'Add Connection'
                )}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </motion.div>
  );
}

function ProviderHealthDashboard({ providers }: { providers: LmsProviderPublicMeta[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Provider health</CardTitle>
      </CardHeader>
      <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
        {providers.map((p) => (
          <div
            key={p.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-raised/50 p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-lg" aria-hidden>{p.icon}</span>
                <p className="truncate text-sm font-medium">{p.displayName}</p>
              </div>
              <p className="mt-1 text-[11px] text-fg-subtle">
                adapter {p.adapterVersion} · {p.capabilities.length} capabilities
              </p>
              {p.notes && (
                <p className="mt-1 text-[11px] text-fg-muted">{p.notes}</p>
              )}
              {!p.ready && p.readyReason && (
                <p className="mt-1 text-[11px] text-warning">{p.readyReason}</p>
              )}
            </div>
            <Badge tone={PROVIDER_STATUS_TONE[p.status]}>
              {PROVIDER_STATUS_LABEL[p.status]}
            </Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

function QueueStatusPanel() {
  const status = useQueueStatus();
  if (status.isLoading || !status.data) return null;
  const s = status.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sync queue</CardTitle>
        <Badge tone={s.enabled && s.redis.ok ? 'success' : 'warning'}>
          {s.enabled ? (s.redis.ok ? 'healthy' : 'degraded') : 'disabled'}
        </Badge>
      </CardHeader>
      <div className="px-4 pb-4">
        {!s.enabled ? (
          <p className="text-sm text-fg-muted">
            Redis is not configured. Manual syncs run inline; automatic scheduling is unavailable.
            Set <code className="rounded bg-surface-raised px-1 text-xs">REDIS_URL</code> in your
            environment to enable the background worker.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
              <QCounter label="Active" value={s.counts?.active ?? 0} tone="text-brand-bright" />
              <QCounter label="Waiting" value={s.counts?.waiting ?? 0} tone="text-warning" />
              <QCounter label="Delayed" value={s.counts?.delayed ?? 0} tone="text-fg-muted" />
              <QCounter label="Completed" value={s.counts?.completed ?? 0} tone="text-success" />
              <QCounter label="Failed" value={s.counts?.failed ?? 0} tone="text-danger" />
            </div>
            <p className="mt-3 text-xs text-fg-subtle">
              Worker mode: <span className="font-medium">{s.workerMode}</span>
              {s.redis.latencyMs != null && <> · Redis ping: {s.redis.latencyMs}ms</>}
              {s.redis.error && <> · {s.redis.error}</>}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

function QCounter({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised/50 px-2 py-1.5 text-center">
      <p className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-fg-subtle">{label}</p>
    </div>
  );
}

export default function UniversityPage() {
  const t = useT();
  const router = useRouter();
  const dashboard = useUniversityDashboard();
  const providers = useLmsProviders();
  const connections = useLmsConnections();
  const syncLogs = useSyncLogs();
  const triggerSync = useTriggerSync();
  const deleteConn = useDeleteConnection();
  const createPreview = useCreatePreview();
  const conflicts = useConflicts('PENDING');

  const [showAddForm, setShowAddForm] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === '1') {
      toast.success('University connected — first sync running.');
      window.history.replaceState({}, '', '/university');
    } else if (params.get('error')) {
      toast.error(`Connection failed: ${params.get('error')}`);
      window.history.replaceState({}, '', '/university');
    }
  }, []);

  const handleSync = async (id: string) => {
    setSyncingId(id);
    try {
      await triggerSync.mutateAsync(id);
      toast.success('Sync started');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSyncingId(null);
    }
  };

  const handlePreview = async (id: string) => {
    setPreviewingId(id);
    try {
      const preview = await createPreview.mutateAsync(id);
      router.push(`/university/preview/${preview.id}`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setPreviewingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteConn.mutateAsync(id);
      toast.success('Connection removed');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const stats = dashboard.data;
  const conflictCount = useMemo<number>(
    () => (conflicts.data ? conflicts.data.length : 0),
    [conflicts.data],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('uni.title')}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t('uni.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/university/diagnostics"
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-raised"
          >
            <Stethoscope className="h-4 w-4" />
            Diagnostics
          </Link>
          <Link
            href="/university/conflicts"
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-raised"
          >
            <GitMerge className="h-4 w-4" />
            Conflicts
            {conflictCount > 0 && (
              <Badge tone="danger" className="ml-1">
                {conflictCount}
              </Badge>
            )}
          </Link>
          <Button size="sm" onClick={() => setShowAddForm(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('uni.addConnection')}
          </Button>
        </div>
      </header>

      {/* Dashboard stats */}
      {dashboard.isLoading || connections.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t('uni.stat.connections')}
            value={stats.connections}
            icon={Cloud}
            tone="bg-brand/12 text-brand-bright"
          />
          <StatCard
            label={t('uni.stat.courses')}
            value={stats.courses}
            icon={BookOpen}
            tone="bg-teal/12 text-teal"
          />
          <StatCard
            label={t('uni.stat.assignments')}
            value={stats.assignments}
            icon={FileText}
            tone="bg-accent/12 text-accent"
          />
          <StatCard
            label={t('uni.stat.exams')}
            value={stats.exams}
            icon={GraduationCap}
            tone="bg-warning/12 text-warning"
          />
          <StatCard
            label={t('uni.stat.announcements')}
            value={stats.announcements}
            icon={Megaphone}
            tone="bg-success/12 text-success"
          />
          <StatCard
            label={t('uni.stat.grades')}
            value={stats.grades}
            icon={Star}
            tone="bg-brand/12 text-brand-bright"
          />
          <StatCard
            label={t('uni.stat.files')}
            value={stats.files}
            icon={FileText}
            tone="bg-teal/12 text-teal"
          />
          <StatCard
            label={t('uni.stat.syncErrors')}
            value={stats.syncErrors}
            icon={stats.syncErrors > 0 ? AlertTriangle : CheckCircle2}
            tone={
              stats.syncErrors > 0
                ? 'bg-danger/12 text-danger'
                : 'bg-success/12 text-success'
            }
          />
        </div>
      ) : null}

      {stats?.lastSyncAt && (
        <p className="text-xs text-fg-subtle">
          Last sync: {new Date(stats.lastSyncAt).toLocaleString()}
        </p>
      )}

      {/* Provider Health Dashboard */}
      {providers.data ? (
        <ProviderHealthDashboard providers={providers.data} />
      ) : (
        <Skeleton className="h-40 rounded-xl" />
      )}

      {/* Queue health */}
      <QueueStatusPanel />

      {/* Add connection form */}
      <AnimatePresence>
        {showAddForm && providers.data && (
          <AddConnectionForm
            onClose={() => setShowAddForm(false)}
            providers={providers.data}
          />
        )}
      </AnimatePresence>

      {/* Connections list */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t('uni.connections')}</h2>
        {connections.isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : connections.data?.length ? (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {connections.data.map((conn) => (
                <ConnectionCard
                  key={conn.id}
                  conn={conn}
                  onSync={() => handleSync(conn.id)}
                  onPreview={() => handlePreview(conn.id)}
                  onDelete={() => handleDelete(conn.id)}
                  isSyncing={syncingId === conn.id}
                  isPreviewing={previewingId === conn.id}
                />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <Card className="flex flex-col items-center justify-center py-12 text-center">
            <CloudOff className="mb-3 h-10 w-10 text-fg-subtle" />
            <p className="font-medium">{t('uni.empty')}</p>
            <p className="mt-1 text-sm text-fg-muted">{t('uni.emptyHint')}</p>
            <Button size="sm" className="mt-4" onClick={() => setShowAddForm(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('uni.addConnection')}
            </Button>
          </Card>
        )}
      </section>

      {/* Sync history */}
      <section>
        <button
          type="button"
          className="flex w-full items-center gap-2 text-lg font-semibold"
          onClick={() => setShowLogs(!showLogs)}
        >
          {showLogs ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          {t('uni.syncHistory')}
        </button>
        <AnimatePresence>
          {showLogs && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 overflow-hidden"
            >
              {syncLogs.isLoading ? (
                <Skeleton className="h-32 rounded-xl" />
              ) : syncLogs.data?.length ? (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-fg-muted">
                        <th className="px-3 py-2">Connection</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Started</th>
                        <th className="px-3 py-2">Duration</th>
                        <th className="px-3 py-2">Items</th>
                        <th className="px-3 py-2">API</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {syncLogs.data.map((log) => {
                        const dur =
                          log.endedAt && log.startedAt
                            ? Math.round(
                                (new Date(log.endedAt).getTime() -
                                  new Date(log.startedAt).getTime()) /
                                  1000,
                              )
                            : null;
                        const totalCreated =
                          log.coursesCreated +
                          log.assignmentsCreated +
                          log.examsCreated +
                          log.announcementsCreated +
                          log.gradesCreated +
                          log.filesCreated;
                        const totalUpdated =
                          log.coursesUpdated +
                          log.assignmentsUpdated +
                          log.examsUpdated +
                          log.announcementsUpdated +
                          log.gradesUpdated +
                          log.filesUpdated;
                        return (
                          <tr key={log.id}>
                            <td className="px-3 py-2">{log.connection.displayName}</td>
                            <td className="px-3 py-2">
                              <Badge
                                tone={
                                  log.status === 'COMPLETED'
                                    ? 'success'
                                    : log.status === 'FAILED'
                                      ? 'danger'
                                      : log.status === 'RUNNING'
                                        ? 'warning'
                                        : 'neutral'
                                }
                              >
                                {log.status.toLowerCase()}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-fg-muted">
                              {new Date(log.startedAt).toLocaleString()}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-fg-muted">
                              {dur != null ? `${dur}s` : '—'}
                            </td>
                            <td className="px-3 py-2 text-fg-muted">
                              +{totalCreated} new, {totalUpdated} updated
                            </td>
                            <td className="px-3 py-2 tabular-nums text-fg-muted">
                              {log.apiRequestsMade} req · {log.avgResponseTimeMs}ms
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-4 text-center text-sm text-fg-muted">No sync history yet.</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}
