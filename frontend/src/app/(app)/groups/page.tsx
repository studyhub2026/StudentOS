'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Compass, Plus, Search, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  useCreateGroup,
  useDiscoverGroups,
  useGroups,
  useJoinGroup,
} from '@/hooks/use-groups';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/provider';

export default function GroupsPage() {
  const t = useT();
  const [tab, setTab] = useState<'mine' | 'discover'>('mine');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);

  const { data: groups, isLoading } = useGroups();
  const { data: publicGroups, isLoading: discovering } = useDiscoverGroups(search);
  const createGroup = useCreateGroup();
  const joinGroup = useJoinGroup();

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('groups.title')}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {groups ? `You are in ${groups.length} group${groups.length === 1 ? '' : 's'}` : 'Loading…'}
          </p>
        </div>

        <Button size="sm" onClick={() => setCreating((open) => !open)}>
          <Plus className="h-4 w-4" aria-hidden />
          {t('groups.new')}
        </Button>
      </header>

      {creating ? (
        <Card>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              createGroup.mutate(
                { name: name.trim(), isPublic: true },
                { onSuccess: () => { setName(''); setCreating(false); } },
              );
            }}
          >
            <div className="min-w-0 flex-1">
              <Input
                label="Group name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Chem 241 Study Crew"
                autoFocus
              />
            </div>
            <Button type="submit" loading={createGroup.isPending}>Create</Button>
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
          </form>
        </Card>
      ) : null}

      <Card>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!inviteCode.trim()) return;
            joinGroup.mutate(inviteCode.trim(), { onSuccess: () => setInviteCode('') });
          }}
        >
          <div className="min-w-0 flex-1">
            <Input
              label="Join with an invite code"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder="ABCD1234"
            />
          </div>
          <Button type="submit" variant="secondary" loading={joinGroup.isPending}>
            <UserPlus className="h-4 w-4" aria-hidden />
            Join
          </Button>
        </form>
      </Card>

      <nav className="flex gap-1.5" aria-label="Group views">
        {([['mine', 'My groups', Users], ['discover', 'Discover', Compass]] as const).map(
          ([key, label, Icon]) => (
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
          ),
        )}
      </nav>

      {tab === 'mine' ? (
        isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
        ) : !groups || groups.length === 0 ? (
          <Card className="py-12 text-center">
            <Users className="mx-auto h-10 w-10 text-fg-subtle" aria-hidden />
            <p className="mt-3 font-medium">You are not in any groups yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">
              Create one, join with an invite code, or browse public groups.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {groups.map((group) => (
              <Link
                key={group.id}
                href={`/groups/${group.id}`}
                className="rounded-2xl border border-border bg-surface p-5 transition-all hover:-translate-y-0.5 hover:border-brand/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-medium">{group.name}</h3>
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs capitalize text-fg-subtle">
                    {group.myRole.toLowerCase()}
                  </span>
                </div>
                {group.description ? (
                  <p className="mt-1.5 line-clamp-2 text-sm text-fg-muted">{group.description}</p>
                ) : null}
                <p className="mt-3 text-xs text-fg-subtle">
                  {group.memberCount} member{group.memberCount === 1 ? '' : 's'} ·{' '}
                  {group.channelCount} channel{group.channelCount === 1 ? '' : 's'}
                </p>
              </Link>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search public groups…"
              aria-label="Search public groups"
              className="h-10 w-full rounded-xl border border-border bg-surface-raised pl-9 pr-3 text-sm placeholder:text-fg-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
          </div>

          {discovering ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-24 w-full rounded-2xl" />
              ))}
            </div>
          ) : !publicGroups || publicGroups.length === 0 ? (
            <Card className="py-10 text-center">
              <p className="text-sm text-fg-muted">
                {search ? 'No public groups match that search.' : 'No public groups to join yet.'}
              </p>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {publicGroups.map((group) => (
                <Card key={group.id}>
                  <h3 className="font-medium">{group.name}</h3>
                  {group.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{group.description}</p>
                  ) : null}
                  <p className="mt-2 text-xs text-fg-subtle">
                    {group.memberCount} / {group.maxMembers} members
                  </p>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
