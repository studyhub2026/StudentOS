'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  ChevronLeft,
  ChevronRight,
  Database,
  MessageSquare,
  RotateCcw,
  Search,
  Shield,
  ShieldOff,
  Users,
} from 'lucide-react';
import { StatCard } from '@/components/dashboard/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  useActivityLogs,
  useAdminMessages,
  useAdminOverview,
  useAdminUsers,
  useChangeUserRole,
  useModerateMessage,
  useReinstateUser,
  useRevokeUserSessions,
  useSuspendUser,
  useSystemHealth,
} from '@/hooks/use-admin';
import { useAuthStore } from '@/stores/auth-store';
import { cn, initialsOf } from '@/lib/utils';
import type { Role } from '@/types/api';

type Tab = 'overview' | 'users' | 'moderation' | 'logs' | 'system';

const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
  { key: 'overview', label: 'Overview', icon: Activity },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'moderation', label: 'Moderation', icon: MessageSquare },
  { key: 'logs', label: 'Audit log', icon: Shield },
  { key: 'system', label: 'System', icon: Database },
];

const ROLE_TONE = { ADMIN: 'danger', TEACHER: 'warning', STUDENT: 'neutral' } as const;

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function AdminPage() {
  const currentUser = useAuthStore((state) => state.user);
  const [tab, setTab] = useState<Tab>('overview');

  // The backend enforces this; the client check only avoids rendering a panel
  // whose every request would 403.
  if (currentUser && currentUser.role !== 'ADMIN') {
    return (
      <Card className="mx-auto max-w-md text-center">
        <ShieldOff className="mx-auto h-9 w-9 text-warning" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">Administrators only</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Your account does not have access to this area.
        </p>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Shield className="h-5 w-5 text-brand-bright" aria-hidden />
          Admin
        </h1>
        <p className="mt-1 text-sm text-fg-muted">Platform management and moderation.</p>
      </header>

      <nav className="flex flex-wrap gap-1.5" aria-label="Admin sections">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            aria-current={tab === key ? 'page' : undefined}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
              tab === key
                ? 'border-brand bg-brand/12 text-brand-bright'
                : 'border-border text-fg-muted hover:border-border-strong',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </button>
        ))}
      </nav>

      {tab === 'overview' ? <OverviewTab /> : null}
      {tab === 'users' ? <UsersTab currentUserId={currentUser?.id ?? ''} /> : null}
      {tab === 'moderation' ? <ModerationTab /> : null}
      {tab === 'logs' ? <LogsTab /> : null}
      {tab === 'system' ? <SystemTab /> : null}
    </div>
  );
}

function OverviewTab() {
  const { data, isLoading } = useAdminOverview(30);

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  const peakSignups = data.signups.reduce((peak, day) => Math.max(peak, day.count), 0);

  return (
    <div className="space-y-4">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total users" value={data.users.total} icon={Users} tone="brand" hint={`${data.users.newThisWeek} new this week`} />
        <StatCard label="Active (7d)" value={data.users.active7d} icon={Activity} tone="accent" hint={`${data.users.active30d} in 30 days`} />
        <StatCard label="Study hours (30d)" value={data.activity.studyHours30d} icon={Database} tone="teal" hint={`${data.activity.sessions30d} sessions`} />
        <StatCard label="AI messages (30d)" value={data.activity.aiMessages30d} icon={MessageSquare} tone="success" hint={`${data.content.aiConversations} conversations`} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Sign-ups</CardTitle>
            <span className="text-xs text-fg-subtle">Last 30 days</span>
          </CardHeader>

          {peakSignups === 0 ? (
            <p className="py-10 text-center text-sm text-fg-muted">No sign-ups in this window.</p>
          ) : (
            <div className="flex h-32 items-end gap-1">
              {data.signups.map((day) => (
                <div
                  key={day.date}
                  title={`${day.count} on ${day.date}`}
                  className="flex-1 rounded-t bg-gradient-to-t from-brand/25 to-brand transition-all hover:brightness-125"
                  style={{ height: `${Math.max(4, (day.count / peakSignups) * 100)}%` }}
                />
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
          </CardHeader>
          <dl className="space-y-2.5 text-sm">
            {[
              ['Students', data.users.byRole.STUDENT ?? 0],
              ['Teachers', data.users.byRole.TEACHER ?? 0],
              ['Admins', data.users.byRole.ADMIN ?? 0],
              ['Email verified', data.users.verified],
              ['With 2FA', data.users.withTwoFactor],
              ['Suspended', data.users.suspended],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-center justify-between">
                <dt className="text-fg-muted">{label}</dt>
                <dd className="font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Content</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          {Object.entries(data.content).map(([key, value]) => (
            <div key={key}>
              <p className="text-2xl font-semibold tabular-nums">{value}</p>
              <p className="text-xs capitalize text-fg-subtle">
                {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function UsersTab({ currentUserId }: { currentUserId: string }) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState<'active' | 'suspended' | 'unverified' | undefined>();
  const search = useDebouncedValue(searchInput, 300);

  const filters = useMemo(
    () => ({ page, limit: 25, ...(search ? { search } : {}), ...(status ? { status } : {}) }),
    [page, search, status],
  );

  const { data, isLoading } = useAdminUsers(filters);
  const changeRole = useChangeUserRole();
  const suspend = useSuspendUser();
  const reinstate = useReinstateUser();
  const revokeSessions = useRevokeUserSessions();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setPage(1);
            }}
            placeholder="Search by name, username or email…"
            aria-label="Search users"
            className="h-10 w-full rounded-xl border border-border bg-surface-raised pl-9 pr-3 text-sm placeholder:text-fg-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
        </div>

        <div className="flex gap-1.5">
          {(['active', 'suspended', 'unverified'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={status === value}
              onClick={() => {
                setStatus(status === value ? undefined : value);
                setPage(1);
              }}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs capitalize transition-colors',
                status === value
                  ? 'border-brand bg-brand/15 text-brand-bright'
                  : 'border-border text-fg-muted hover:border-border-strong',
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="font-medium">No users match</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {data.items.map((user) => {
            const isSelf = user.id === currentUserId;
            const suspended = user.deletedAt !== null;

            return (
              <li
                key={user.id}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3',
                  suspended && 'opacity-60',
                )}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-accent text-xs font-semibold text-white">
                  {initialsOf(user.name)}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{user.name}</p>
                    <Badge tone={ROLE_TONE[user.role]}>{user.role.toLowerCase()}</Badge>
                    {suspended ? <Badge tone="danger">suspended</Badge> : null}
                    {!user.emailVerified ? <Badge tone="warning">unverified</Badge> : null}
                    {user.twoFactorEnabled ? <Badge tone="success">2FA</Badge> : null}
                  </div>
                  <p className="truncate text-xs text-fg-subtle">
                    {user.email} · {user.counts.assignments} assignments ·{' '}
                    {user.counts.notes} notes ·{' '}
                    {user.lastActiveDate
                      ? `active ${new Date(user.lastActiveDate).toLocaleDateString()}`
                      : 'never active'}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <select
                    value={user.role}
                    disabled={isSelf || changeRole.isPending}
                    aria-label={`Role for ${user.name}`}
                    onChange={(event) =>
                      changeRole.mutate({ id: user.id, role: event.target.value as Role })
                    }
                    className="h-8 rounded-lg border border-border bg-surface-raised px-2 text-xs focus:border-brand focus:outline-none disabled:opacity-40"
                  >
                    <option value="STUDENT">Student</option>
                    <option value="TEACHER">Teacher</option>
                    <option value="ADMIN">Admin</option>
                  </select>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isSelf}
                    onClick={() => revokeSessions.mutate(user.id)}
                    title="Sign this user out everywhere"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  </Button>

                  {suspended ? (
                    <Button variant="ghost" size="sm" onClick={() => reinstate.mutate(user.id)}>
                      Reinstate
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      disabled={isSelf}
                      onClick={() => {
                        const reason = window.prompt(`Suspend ${user.name}? Optional reason:`);
                        if (reason !== null) {
                          suspend.mutate({ id: user.id, ...(reason ? { reason } : {}) });
                        }
                      }}
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data && data.pagination.totalPages > 1 ? (
        <nav className="flex items-center justify-between" aria-label="Pagination">
          <p className="text-sm text-fg-subtle">
            Page {data.pagination.page} of {data.pagination.totalPages} · {data.pagination.total} users
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={!data.pagination.hasPrevious} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Previous
            </Button>
            <Button variant="secondary" size="sm" disabled={!data.pagination.hasNext} onClick={() => setPage((p) => p + 1)}>
              Next
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function ModerationTab() {
  const { data: messages, isLoading } = useAdminMessages();
  const moderate = useModerateMessage();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent messages</CardTitle>
        <span className="text-xs text-fg-subtle">Newest 50 across all groups</span>
      </CardHeader>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      ) : !messages || messages.length === 0 ? (
        <p className="py-10 text-center text-sm text-fg-muted">No messages yet.</p>
      ) : (
        <ul className="space-y-2">
          {messages.map((message) => (
            <li key={message.id} className="group flex items-start gap-3 rounded-xl border border-border bg-surface-raised/60 p-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-accent text-xs font-semibold text-white">
                {initialsOf(message.author.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-fg-subtle">
                  {message.author.name} in {message.channel.group?.name ?? 'unknown'} #
                  {message.channel.name} ·{' '}
                  {new Date(message.createdAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <p className="mt-1 break-words text-sm">{message.content}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-danger opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => {
                  const reason = window.prompt('Remove this message? Optional reason:');
                  if (reason !== null) {
                    moderate.mutate({ messageId: message.id, ...(reason ? { reason } : {}) });
                  }
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LogsTab() {
  const [page, setPage] = useState(1);
  const [actionInput, setActionInput] = useState('');
  const action = useDebouncedValue(actionInput, 300);
  const { data, isLoading } = useActivityLogs(page, action || undefined);

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={actionInput}
        onChange={(event) => {
          setActionInput(event.target.value);
          setPage(1);
        }}
        placeholder="Filter by action, e.g. admin.user"
        aria-label="Filter audit log"
        className="h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm placeholder:text-fg-subtle focus:border-brand focus:outline-none"
      />

      <Card>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="py-10 text-center text-sm text-fg-muted">No log entries.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.items.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-brand-bright">
                  {entry.action}
                </code>
                <span className="text-fg-muted">{entry.user?.name ?? 'system'}</span>
                {entry.entityType ? (
                  <span className="text-xs text-fg-subtle">
                    {entry.entityType} {entry.entityId?.slice(0, 8)}
                  </span>
                ) : null}
                <span className="ml-auto text-xs tabular-nums text-fg-subtle">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data && data.pagination.totalPages > 1 ? (
        <nav className="flex items-center justify-between" aria-label="Pagination">
          <p className="text-sm text-fg-subtle">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={!data.pagination.hasPrevious} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="secondary" size="sm" disabled={!data.pagination.hasNext} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function SystemTab() {
  const { data, isLoading } = useSystemHealth();

  if (isLoading || !data) {
    return <Skeleton className="h-64 w-full rounded-2xl" />;
  }

  const integrations = [
    ['Gemini AI', data.integrations.gemini],
    ['Cloudinary', data.integrations.cloudinary],
    ['Redis', data.integrations.redis],
  ] as const;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Runtime</CardTitle>
          <Badge tone={data.environment === 'production' ? 'success' : 'info'}>
            {data.environment}
          </Badge>
        </CardHeader>
        <dl className="space-y-2.5 text-sm">
          {[
            ['Uptime', formatUptime(data.uptimeSeconds)],
            ['Node', data.nodeVersion],
            ['Memory (RSS)', `${data.memory.rssMb} MB`],
            ['Heap used', `${data.memory.heapUsedMb} / ${data.memory.heapTotalMb} MB`],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between">
              <dt className="text-fg-muted">{label}</dt>
              <dd className="font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dependencies</CardTitle>
        </CardHeader>

        <div
          className={cn(
            'mb-3 flex items-center gap-2 rounded-xl border p-3',
            data.database.reachable
              ? 'border-success/30 bg-success/10'
              : 'border-danger/30 bg-danger/10',
          )}
        >
          {data.database.reachable ? (
            <Database className="h-4 w-4 text-success" aria-hidden />
          ) : (
            <AlertTriangle className="h-4 w-4 text-danger" aria-hidden />
          )}
          <span className="text-sm font-medium">
            Database {data.database.reachable ? 'reachable' : 'unreachable'}
          </span>
          {data.database.latencyMs !== null ? (
            <span className="ml-auto text-xs tabular-nums text-fg-subtle">
              {data.database.latencyMs}ms
            </span>
          ) : null}
        </div>

        <ul className="space-y-2">
          {integrations.map(([label, configured]) => (
            <li key={label} className="flex items-center justify-between text-sm">
              <span className="text-fg-muted">{label}</span>
              <Badge tone={configured ? 'success' : 'neutral'}>
                {configured ? 'configured' : 'not configured'}
              </Badge>
            </li>
          ))}
          <li className="flex items-center justify-between text-sm">
            <span className="text-fg-muted">OAuth providers</span>
            <span className="text-xs text-fg-subtle">
              {data.integrations.oauth.length > 0
                ? data.integrations.oauth.join(', ')
                : 'none configured'}
            </span>
          </li>
        </ul>
      </Card>
    </div>
  );
}
