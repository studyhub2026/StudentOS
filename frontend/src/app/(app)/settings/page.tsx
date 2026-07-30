'use client';

import { BadgeCheck, Flame, ShieldCheck, Sparkles } from 'lucide-react';
import { AvatarUploader } from '@/components/uploads/file-uploader';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth-store';

const ROLE_TONE = { ADMIN: 'danger', TEACHER: 'warning', STUDENT: 'neutral' } as const;

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
