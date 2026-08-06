'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BarChart3,
  BookOpen,
  Bot,
  CalendarDays,
  CheckSquare,
  Database,
  FileText,
  Flame,
  ClipboardList,
  GraduationCap,
  Layers,
  ListTree,
  LogOut,
  Menu,
  PenLine,
  Settings,
  Shield,
  Sparkles,
  Timer,
  TrendingUp,
  Trophy,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CommandPalette } from '@/components/command-palette';
import { OmnelMark } from '@/components/brand/brand-mark';
import { AiToolbar } from '@/components/ai-toolbar';
import { NotificationBell } from '@/components/notification-bell';
import { cn, initialsOf } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { useT } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n/dictionaries';

const NAV: { href: string; labelKey: TranslationKey; icon: typeof BarChart3 }[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', icon: BarChart3 },
  { href: '/ai', labelKey: 'nav.ai', icon: Bot },
  { href: '/tutors', labelKey: 'nav.tutors', icon: GraduationCap },
  { href: '/assignments', labelKey: 'nav.assignments', icon: CheckSquare },
  { href: '/schedule', labelKey: 'nav.schedule', icon: CalendarDays },
  { href: '/notes', labelKey: 'nav.notes', icon: BookOpen },
  { href: '/flashcards', labelKey: 'nav.flashcards', icon: Layers },
  { href: '/pdf-reader', labelKey: 'nav.pdfReader', icon: FileText },
  { href: '/whiteboard', labelKey: 'nav.whiteboard', icon: PenLine },
  { href: '/knowledge', labelKey: 'nav.knowledge', icon: Database },
  { href: '/focus', labelKey: 'nav.focus', icon: Timer },
  { href: '/analytics', labelKey: 'nav.analytics', icon: TrendingUp },
  { href: '/timeline', labelKey: 'nav.timeline', icon: ListTree },
  { href: '/exam', labelKey: 'nav.exam', icon: ClipboardList },
  { href: '/achievements', labelKey: 'nav.achievements', icon: Trophy },
  { href: '/groups', labelKey: 'nav.groups', icon: Users },
];

/** Appended only for administrators. */
const ADMIN_NAV = { href: '/admin', labelKey: 'nav.admin' as TranslationKey, icon: Shield } as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const user = useAuthStore((state) => state.user);
  const initialised = useAuthStore((state) => state.initialised);
  const logout = useAuthStore((state) => state.logout);
  const t = useT();

  // Wait for the bootstrap refresh to settle before redirecting, otherwise a
  // signed-in user is bounced to /login on every hard reload.
  useEffect(() => {
    if (initialised && !user) router.replace('/login');
  }, [initialised, user, router]);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (!initialised) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex items-center gap-3 text-fg-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          Loading your workspace…
        </div>
      </div>
    );
  }

  if (!user) return null;

  const renderSidebar = (prefix: string) => (
    <div className="flex h-full flex-col">
      <Link href="/dashboard" className="flex items-center gap-2 px-2 py-1 font-semibold">
        <OmnelMark className="h-7 w-7" />
        <span className="text-lg tracking-tight">
          <span className="text-fg">Omnel</span>
          <span className="gradient-text">OS</span>
        </span>
      </Link>

      <div className="mt-5 flex items-center gap-2">
        <div className="flex-1">
          <CommandPalette />
        </div>
        <div className="hidden lg:block">
          <NotificationBell />
        </div>
      </div>

      <nav className="mt-4 flex-1 space-y-1">
        {[...NAV, ...(user.role === 'ADMIN' ? [ADMIN_NAV] : [])].map(({ href, labelKey, icon: Icon }) => {
          const label = t(labelKey);
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
                active ? 'text-brand-bright' : 'text-fg-muted hover:bg-surface-raised hover:text-fg',
              )}
            >
              {active ? (
                <motion.span
                  layoutId={`${prefix}-nav-active`}
                  className="absolute inset-0 -z-10 rounded-xl bg-brand/12 ring-1 ring-inset ring-brand/20"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  aria-hidden
                />
              ) : null}
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0 transition-transform duration-150 group-hover:scale-110',
                  active && 'text-brand-bright',
                )}
                aria-hidden
              />
              <span className={active ? 'font-medium' : ''}>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Streak + XP */}
      <div className="mt-4 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-warning/20 bg-warning/8 px-3 py-2">
          <Flame className="h-4 w-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-none tabular-nums">{user.currentStreak}d</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-fg-subtle">{t('dashboard.streak')}</p>
          </div>
        </div>
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-teal/20 bg-teal/8 px-3 py-2">
          <Zap className="h-4 w-4 shrink-0 text-teal" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-none tabular-nums">
              {user.totalXp.toLocaleString()}
            </p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-fg-subtle">{t('dashboard.xp')}</p>
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <Link
          href="/settings"
          aria-current={pathname === '/settings' ? 'page' : undefined}
          className={cn(
            'flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-raised',
            pathname === '/settings' && 'bg-brand/12',
          )}
        >
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-accent text-sm font-semibold text-white">
              {initialsOf(user.name)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-fg-subtle">{user.email}</p>
          </div>
          <Settings className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
        </Link>

        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-start"
          onClick={() => {
            void logout().then(() => router.replace('/login'));
          }}
        >
          <LogOut className="h-4 w-4" aria-hidden />
          {t('nav.signOut')}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface/40 p-4 lg:block">
        {renderSidebar('desktop')}
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.button
              type="button"
              aria-label={t('nav.closeNavigation')}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.aside
              className="glass absolute inset-y-0 left-0 w-64 p-4"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            >
              {renderSidebar('mobile')}
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label={mobileOpen ? t('nav.closeNavigation') : t('nav.openNavigation')}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <span className="flex flex-1 items-center gap-2 font-semibold">
            <OmnelMark className="h-6 w-6" />
            <span className="text-base tracking-tight">
              <span className="text-fg">Omnel</span>
              <span className="gradient-text">OS</span>
            </span>
          </span>
          <NotificationBell />
          <CommandPalette />
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
        <AiToolbar />
      </div>
    </div>
  );
}
