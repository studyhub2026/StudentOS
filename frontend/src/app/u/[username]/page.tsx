import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Award, BookOpen, Flame, GraduationCap, Layers, Timer, Trophy } from 'lucide-react';
import { getPublicProfile } from '@/server/services/profile.service';

interface Props {
  params: Promise<{ username: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props) {
  const { username } = await params;
  const profile = await getPublicProfile(username);
  if (!profile) return { title: 'Profile not found · OmnelOS' };
  return {
    title: `${profile.name} (@${profile.username}) · OmnelOS`,
    description: profile.bio ?? `${profile.name}'s public OmnelOS profile.`,
  };
}

function formatHours(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const TIER_COLOR: Record<string, string> = {
  BRONZE: 'text-amber-500',
  SILVER: 'text-slate-300',
  GOLD: 'text-yellow-400',
  PLATINUM: 'text-sky-300',
  DIAMOND: 'text-purple-300',
};

export default async function PublicProfilePage({ params }: Props) {
  const { username } = await params;
  const profile = await getPublicProfile(username);
  if (!profile) notFound();

  const joined = new Date(profile.joinedAt).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen bg-surface text-fg">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
        <header className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-raised text-2xl font-semibold text-fg-muted sm:h-24 sm:w-24">
            {profile.avatarUrl ? (
              // Public page — img keeps it lightweight; no auth headers needed.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatarUrl}
                alt={`${profile.name}'s avatar`}
                className="h-full w-full object-cover"
              />
            ) : (
              profile.name.slice(0, 2).toUpperCase()
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{profile.name}</h1>
            <p className="text-sm text-fg-muted">@{profile.username} · Joined {joined}</p>
            {profile.bio ? (
              <p className="mt-3 max-w-2xl text-sm text-fg-muted">{profile.bio}</p>
            ) : null}
          </div>
        </header>

        <section
          aria-label="Stats"
          className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
        >
          <Stat label="Level" value={profile.stats.level.toString()} icon={<GraduationCap className="h-4 w-4" />} />
          <Stat label="XP" value={profile.stats.totalXp.toLocaleString()} icon={<Trophy className="h-4 w-4" />} />
          <Stat
            label="Study hours"
            value={formatHours(profile.stats.totalStudyMinutes)}
            icon={<Timer className="h-4 w-4" />}
          />
          <Stat
            label="Current streak"
            value={`${profile.stats.currentStreak}d`}
            icon={<Flame className="h-4 w-4" />}
          />
          <Stat
            label="Subjects"
            value={profile.stats.subjectsCount.toString()}
            icon={<Layers className="h-4 w-4" />}
          />
          <Stat
            label="Notes"
            value={profile.stats.notesCount.toString()}
            icon={<BookOpen className="h-4 w-4" />}
          />
        </section>

        <section className="mt-10">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-fg-subtle">
            <Award className="h-4 w-4" aria-hidden />
            Recent achievements
            <span className="rounded-full bg-surface-raised px-2 py-0.5 text-[10px] font-medium tracking-normal text-fg-muted">
              {profile.stats.achievementsUnlocked} total
            </span>
          </h2>
          {profile.achievements.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface-raised/60 p-6 text-center text-sm text-fg-subtle">
              No achievements unlocked yet.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {profile.achievements.map((a) => (
                <div
                  key={a.key}
                  className="flex items-start gap-3 rounded-xl border border-border bg-surface-raised/60 p-4"
                >
                  <span
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface text-lg ${
                      TIER_COLOR[a.tier] ?? 'text-fg'
                    }`}
                    aria-hidden
                  >
                    {a.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{a.name}</p>
                    <p className="line-clamp-2 text-xs text-fg-muted">{a.description}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-widest text-fg-subtle">
                      {a.tier} · {new Date(a.unlockedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="mt-12 border-t border-border pt-4 text-xs text-fg-subtle">
          Powered by{' '}
          <Link href="/" className="text-brand-bright hover:underline">
            OmnelOS
          </Link>
        </footer>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised/60 p-4">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-subtle">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
    </div>
  );
}
