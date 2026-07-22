import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Brain,
  CalendarDays,
  CheckCircle2,
  Flame,
  Layers,
  MessageSquare,
  Sparkles,
  Timer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const FEATURES = [
  {
    icon: Brain,
    title: 'AI study planner',
    body: 'Gemini reads your deadlines and workload, then blocks out a realistic week — and rebuilds it when life gets in the way.',
  },
  {
    icon: CheckCircle2,
    title: 'Assignments that track themselves',
    body: 'Priorities, subjects, labels, recurring work and reminders. Filter and search across every course at once.',
  },
  {
    icon: Layers,
    title: 'Flashcards with real spaced repetition',
    body: 'An SM-2 scheduler decides what you review and when, so you spend your time on what you are about to forget.',
  },
  {
    icon: Timer,
    title: 'Focus sessions',
    body: 'Pomodoro timers, ambient sound and full-screen deep work, with session history feeding your analytics.',
  },
  {
    icon: BarChart3,
    title: 'Analytics that explain themselves',
    body: 'Study hours, subject breakdowns, streaks and a productivity score you can actually reason about.',
  },
  {
    icon: MessageSquare,
    title: 'Study groups',
    body: 'Shared notes, live chat and leaderboards — the accountability part of studying, without leaving the app.',
  },
];

const STATS = [
  { value: '11', label: 'AI features' },
  { value: 'SM-2', label: 'Review algorithm' },
  { value: '3', label: 'OAuth providers' },
  { value: '100%', label: 'Gemini powered' },
];

export default function LandingPage() {
  return (
    <main className="relative overflow-hidden">
      {/* Ambient background wash */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-brand/18 blur-[130px]" />
        <div className="absolute top-1/3 -right-32 h-[28rem] w-[28rem] rounded-full bg-accent/12 blur-[120px]" />
        <div className="absolute bottom-0 -left-32 h-[26rem] w-[26rem] rounded-full bg-teal/10 blur-[120px]" />
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand to-accent">
            <Sparkles className="h-4 w-4 text-white" aria-hidden />
          </span>
          StudentOS <span className="gradient-text">AI</span>
        </Link>

        <nav className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <Link href="/register">
            <Button size="sm">Get started</Button>
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-4xl px-6 pt-16 pb-20 text-center sm:pt-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1 text-xs text-fg-muted backdrop-blur">
          <Flame className="h-3.5 w-3.5 text-brand-bright" aria-hidden />
          Powered end-to-end by Google Gemini
        </span>

        <h1 className="mt-6 text-balance text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
          Your entire academic life,
          <br />
          <span className="gradient-text">in one place.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-fg-muted">
          StudentOS AI brings assignments, timetables, notes, flashcards and focus
          sessions together — then uses AI to tell you what to work on next.
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/register">
            <Button size="lg" className="w-full sm:w-auto">
              Start for free
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="secondary" className="w-full sm:w-auto">
              Sign in
            </Button>
          </Link>
        </div>

        <p className="mt-4 text-xs text-fg-subtle">
          No credit card required · Free while in development
        </p>
      </section>

      {/* Dashboard preview */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="glass rounded-2xl p-2 shadow-[var(--shadow-glow)]">
          <div className="rounded-xl border border-border bg-canvas/80 p-6">
            <div className="mb-5 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              {[
                { label: 'Study today', value: '2h 40m', tone: 'text-brand-bright' },
                { label: 'Due this week', value: '7', tone: 'text-accent' },
                { label: 'Streak', value: '12 days', tone: 'text-teal' },
                { label: 'Productivity', value: '84', tone: 'text-success' },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-border bg-surface p-4 text-left">
                  <p className="text-xs text-fg-subtle">{stat.label}</p>
                  <p className={`mt-1 text-2xl font-semibold ${stat.tone}`}>{stat.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-surface p-4 sm:col-span-2">
                <p className="mb-3 text-left text-sm font-medium">Study hours</p>
                <div className="flex h-28 items-end gap-1.5">
                  {[38, 55, 30, 72, 61, 88, 47, 66, 79, 42, 91, 58].map((height, index) => (
                    <div
                      key={index}
                      className="flex-1 rounded-t bg-gradient-to-t from-brand/25 to-brand"
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4 text-left">
                <p className="mb-3 text-sm font-medium">Up next</p>
                <ul className="space-y-2.5">
                  {[
                    ['Physics problem set', 'Due today'],
                    ['History essay', 'Tomorrow'],
                    ['Calculus revision', 'Friday'],
                  ].map(([title, when]) => (
                    <li key={title} className="flex items-start gap-2">
                      <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
                      <span className="text-xs">
                        <span className="block text-fg">{title}</span>
                        <span className="text-fg-subtle">{when}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-4 rounded-2xl border border-border bg-surface/50 p-8 sm:grid-cols-4">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="gradient-text text-3xl font-bold">{stat.value}</p>
              <p className="mt-1 text-sm text-fg-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
          Everything a student actually needs
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-fg-muted">
          Not another note app with a chatbot bolted on. Every feature is built
          around how studying really works.
        </p>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="group rounded-2xl border border-border bg-surface p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-[var(--shadow-glow)]"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-brand/25 bg-brand/12">
                <Icon className="h-5 w-5 text-brand-bright" aria-hidden />
              </span>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div className="relative overflow-hidden rounded-2xl border border-brand/25 bg-gradient-to-br from-brand/12 via-surface to-accent/10 p-10 text-center">
          <h2 className="text-3xl font-bold tracking-tight">Ready to get organised?</h2>
          <p className="mx-auto mt-3 max-w-lg text-fg-muted">
            Set up your subjects, import your deadlines, and let the planner build
            your first week.
          </p>
          <Link href="/register" className="mt-7 inline-block">
            <Button size="lg">
              Create your account
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-fg-subtle sm:flex-row">
          <p>© {new Date().getFullYear()} StudentOS AI</p>
          <p>Built with Next.js, Express and Google Gemini.</p>
        </div>
      </footer>
    </main>
  );
}
