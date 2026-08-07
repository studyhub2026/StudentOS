'use client';

import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Database,
  Layers,
  Server,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDiagnostics } from '@/hooks/use-university';
import { cn } from '@/lib/utils';

const CONNECTION_STATUS_TONE = {
  CONNECTED: 'success',
  DISCONNECTED: 'neutral',
  ERROR: 'danger',
  SYNCING: 'warning',
} as const;

const PROVIDER_STATUS_TONE = {
  LIVE: 'success',
  IN_DEVELOPMENT: 'warning',
  PLANNED: 'neutral',
  UNSUPPORTED: 'danger',
} as const;

function HealthTile({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-raised/50 p-4">
      <div
        className={cn(
          'rounded-lg p-2',
          ok ? 'bg-success/12 text-success' : 'bg-danger/12 text-danger',
        )}
      >
        {ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
      </div>
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-fg-muted">{detail ?? (ok ? 'Healthy' : 'Unhealthy')}</p>
      </div>
    </div>
  );
}

export default function DiagnosticsPage() {
  const q = useDiagnostics();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <Link
          href="/university"
          className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to University Sync
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Sync diagnostics</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Real-time health of the platform: infrastructure, per-connection status, and recent
          errors. Refreshes every 15 seconds.
        </p>
      </header>

      {q.isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : q.data ? (
        <>
          {/* Infrastructure */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Infrastructure</CardTitle>
            </CardHeader>
            <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-4">
              <HealthTile
                label="Postgres"
                ok={q.data.infrastructure.postgres.ok}
                detail={q.data.infrastructure.postgres.error}
              />
              <HealthTile
                label="Redis"
                ok={q.data.infrastructure.redis.ok}
                detail={
                  q.data.infrastructure.redis.error ??
                  q.data.infrastructure.redis.note ??
                  (q.data.infrastructure.redis.latencyMs != null
                    ? `${q.data.infrastructure.redis.latencyMs} ms ping`
                    : 'Healthy')
                }
              />
              <HealthTile
                label="Worker"
                ok={true}
                detail={`Mode: ${q.data.infrastructure.workerMode}`}
              />
              <HealthTile
                label="Queue"
                ok={q.data.infrastructure.queue !== null}
                detail={
                  q.data.infrastructure.queue
                    ? `${q.data.infrastructure.queue.active} active · ${q.data.infrastructure.queue.waiting} waiting · ${q.data.infrastructure.queue.failed} failed`
                    : 'Not available'
                }
              />
            </div>
          </Card>

          {/* Per-connection status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Connections</CardTitle>
            </CardHeader>
            <div className="space-y-3 px-4 pb-4">
              {q.data.connections.length === 0 ? (
                <p className="py-6 text-center text-sm text-fg-muted">
                  No connections yet. Add one from the University Sync page.
                </p>
              ) : (
                q.data.connections.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-xl border border-border bg-surface-raised/50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {c.status === 'CONNECTED' ? (
                            <Wifi className="h-4 w-4 text-success" />
                          ) : c.status === 'ERROR' ? (
                            <AlertTriangle className="h-4 w-4 text-danger" />
                          ) : (
                            <WifiOff className="h-4 w-4 text-fg-muted" />
                          )}
                          <p className="truncate font-medium">{c.displayName}</p>
                          <Badge tone={CONNECTION_STATUS_TONE[c.status]}>
                            {c.status.toLowerCase()}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-fg-muted">
                          {c.provider.replace('_', ' ')} · adapter {c.adapterVersion}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-fg-subtle">{c.portalUrl}</p>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 text-xs text-fg-muted sm:grid-cols-2">
                      <div>
                        <span className="text-fg">Auth</span>:{' '}
                        {c.tokenExpiresAt
                          ? new Date(c.tokenExpiresAt).getTime() > Date.now()
                            ? `Valid until ${new Date(c.tokenExpiresAt).toLocaleString()}`
                            : `Expired ${new Date(c.tokenExpiresAt).toLocaleString()}`
                          : 'No expiry recorded'}
                      </div>
                      <div>
                        <span className="text-fg">Auto-sync</span>:{' '}
                        {c.autoSync ? `Every ${c.syncInterval} min` : 'Off'}
                      </div>
                      <div>
                        <span className="text-fg">Last success</span>:{' '}
                        {c.lastSuccessfulSync
                          ? new Date(c.lastSuccessfulSync.startedAt).toLocaleString()
                          : 'Never'}
                      </div>
                      <div>
                        <span className="text-fg">Last failure</span>:{' '}
                        {c.lastFailedSync
                          ? new Date(c.lastFailedSync.startedAt).toLocaleString()
                          : 'None'}
                      </div>
                      <div>
                        <span className="text-fg">Total failed syncs</span>: {c.totalFailedSyncs}
                      </div>
                      <div>
                        <span className="text-fg">Avg API response</span>: {c.avgApiResponseMs} ms
                      </div>
                      <div>
                        <span className="text-fg">Avg queue wait</span>: {c.avgQueueWaitMs} ms
                      </div>
                      <div>
                        <span className="text-fg">Avg execution</span>: {c.avgQueueExecutionMs} ms
                      </div>
                    </div>

                    {c.statusDetail && (
                      <p className="mt-2 rounded-md bg-danger/10 p-2 text-xs text-danger">
                        {c.statusDetail}
                      </p>
                    )}
                    {c.lastFailedSync?.errors && (
                      <p className="mt-2 rounded-md bg-danger/10 p-2 text-xs text-danger">
                        {c.lastFailedSync.errors}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Recent errors */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent errors</CardTitle>
              {q.data.recentErrors.length > 0 && (
                <Badge tone="danger">{q.data.recentErrors.length}</Badge>
              )}
            </CardHeader>
            <div className="px-4 pb-4">
              {q.data.recentErrors.length === 0 ? (
                <p className="py-4 text-center text-sm text-fg-muted">
                  No recent sync errors.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-fg-muted">
                        <th className="px-3 py-2">When</th>
                        <th className="px-3 py-2">Connection</th>
                        <th className="px-3 py-2">Error</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {q.data.recentErrors.map((e) => (
                        <tr key={e.id}>
                          <td className="px-3 py-2 text-fg-muted">
                            {new Date(e.startedAt).toLocaleString()}
                          </td>
                          <td className="px-3 py-2">{e.connection.displayName}</td>
                          <td className="max-w-md px-3 py-2 text-danger">
                            {e.errors ?? 'Unknown error'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>

          {/* Provider registry snapshot */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Provider registry</CardTitle>
              <Badge tone="neutral">{q.data.providers.length}</Badge>
            </CardHeader>
            <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
              {q.data.providers.map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg border border-border bg-surface-raised/50 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">
                      <span aria-hidden>{p.icon}</span> {p.displayName}
                    </p>
                    <Badge tone={PROVIDER_STATUS_TONE[p.status]}>
                      {p.status.toLowerCase().replace('_', ' ')}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-fg-muted">
                    v{p.adapterVersion} · {p.authMode}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : (
        <p className="text-sm text-danger">Could not load diagnostics.</p>
      )}
    </div>
  );
}
