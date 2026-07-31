'use client';

import { BadgeCheck, Brain, Flame, ShieldCheck, Sparkles, X } from 'lucide-react';
import { AvatarUploader } from '@/components/uploads/file-uploader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAiMemory, useClearMemory, useDeleteMemory } from '@/hooks/use-ai-memory';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';

const ROLE_TONE = { ADMIN: 'danger', TEACHER: 'warning', STUDENT: 'neutral' } as const;

const CATEGORY_TONE: Record<string, string> = {
  profile: 'text-brand-bright bg-brand/12',
  study: 'text-teal bg-teal/12',
  goals: 'text-accent bg-accent/12',
  exams: 'text-warning bg-warning/12',
  habits: 'text-success bg-success/12',
  general: 'text-fg-muted bg-surface-raised',
};

export default function SettingsPage() {
  const user = useAuthStore((state) => state.user);

  if (!user) return null;

  const joined = new Date(user.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-fg-muted">Your profile and account details.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Profile picture</CardTitle>
        </CardHeader>
        <AvatarUploader currentUrl={user.avatarUrl} name={user.name} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <Badge tone={ROLE_TONE[user.role]}>{user.role.toLowerCase()}</Badge>
        </CardHeader>

        <dl className="divide-y divide-border text-sm">
          {[
            ['Name', user.name],
            ['Username', `@${user.username}`],
            ['Email', user.email],
            ['Member since', joined],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between py-2.5">
              <dt className="text-fg-muted">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}

          <div className="flex items-center justify-between py-2.5">
            <dt className="text-fg-muted">Email verified</dt>
            <dd>
              {user.emailVerified ? (
                <span className="flex items-center gap-1.5 font-medium text-success">
                  <BadgeCheck className="h-4 w-4" aria-hidden />
                  Verified
                </span>
              ) : (
                <span className="font-medium text-warning">Not verified</span>
              )}
            </dd>
          </div>

          <div className="flex items-center justify-between py-2.5">
            <dt className="text-fg-muted">Two-factor auth</dt>
            <dd>
              {user.twoFactorEnabled ? (
                <span className="flex items-center gap-1.5 font-medium text-success">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  Enabled
                </span>
              ) : (
                <span className="font-medium text-fg-muted">Off</span>
              )}
            </dd>
          </div>
        </dl>
      </Card>

      <AiMemoryCard />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand/12">
            <Sparkles className="h-5 w-5 text-brand-bright" aria-hidden />
          </span>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{user.totalXp.toLocaleString()}</p>
            <p className="text-xs text-fg-subtle">Total XP</p>
          </div>
        </Card>

        <Card className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-warning/12">
            <Flame className="h-5 w-5 text-warning" aria-hidden />
          </span>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{user.currentStreak}</p>
            <p className="text-xs text-fg-subtle">Day streak</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function AiMemoryCard() {
  const { data: memories, isLoading } = useAiMemory();
  const remove = useDeleteMemory();
  const clear = useClearMemory();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-brand-bright" aria-hidden />
            What the AI remembers
          </span>
        </CardTitle>
        {memories && memories.length > 0 ? (
          <button
            type="button"
            onClick={() => clear.mutate()}
            className="text-xs font-medium text-danger hover:underline"
          >
            Clear all
          </button>
        ) : null}
      </CardHeader>

      <p className="mb-3 text-xs text-fg-subtle">
        The assistant learns durable facts from your chats to personalise its help. You are always
        in control — remove anything here.
      </p>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        </div>
      ) : !memories || memories.length === 0 ? (
        <p className="py-4 text-center text-sm text-fg-muted">
          Nothing remembered yet. Chat with the AI and it will pick up on your subjects, goals and
          study habits.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {memories.map((memory) => (
            <li
              key={memory.id}
              className="group flex items-center gap-3 rounded-lg border border-border bg-surface p-2.5 text-sm"
            >
              <span
                className={cn(
                  'shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  CATEGORY_TONE[memory.category] ?? CATEGORY_TONE.general,
                )}
              >
                {memory.category}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-fg-muted">{memory.key.replace(/_/g, ' ')}: </span>
                <span className="font-medium">{memory.value}</span>
              </span>
              <button
                type="button"
                aria-label={`Forget ${memory.key.replace(/_/g, ' ')}`}
                onClick={() => remove.mutate(memory.id)}
                className="shrink-0 rounded p-0.5 text-fg-subtle opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
