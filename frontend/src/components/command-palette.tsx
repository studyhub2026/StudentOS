'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BarChart3,
  BookOpen,
  Bot,
  CalendarDays,
  CheckSquare,
  Clock,
  FileText,
  GraduationCap,
  Layers,
  Loader2,
  MessageSquare,
  Moon,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  Target,
  Timer,
  TrendingUp,
  Users,
  Wrench,
  X,
  Zap,
  Bell,
  Upload,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSearch, type SearchCategory } from '@/hooks/use-search';
import { useSearchHistory } from '@/hooks/use-search-history';
import { HighlightedText } from '@/components/highlighted-text';
import { useAuthStore } from '@/stores/auth-store';

interface Command {
  id: string;
  label: string;
  icon: LucideIcon;
  section: string;
  action: () => void;
  keywords?: string;
}

const CATEGORY_ICONS: Record<SearchCategory, LucideIcon> = {
  assignment: CheckSquare,
  note: BookOpen,
  subject: Layers,
  flashcard_deck: Layers,
  flashcard: FileText,
  schedule: CalendarDays,
  ai_conversation: Bot,
  tutor_conversation: GraduationCap,
  group: Users,
  group_message: MessageSquare,
  uploaded_file: Upload,
  goal: Target,
  notification: Bell,
};

const CATEGORY_LABELS: Record<SearchCategory, string> = {
  assignment: 'Assignment',
  note: 'Note',
  subject: 'Subject',
  flashcard_deck: 'Deck',
  flashcard: 'Flashcard',
  schedule: 'Schedule',
  ai_conversation: 'AI Chat',
  tutor_conversation: 'Tutor Chat',
  group: 'Group',
  group_message: 'Message',
  uploaded_file: 'File',
  goal: 'Goal',
  notification: 'Notification',
};

function toggleTheme(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const nowDark = !root.classList.contains('dark');
  root.classList.toggle('dark', nowDark);
  try {
    window.localStorage.setItem('studentos.theme', nowDark ? 'dark' : 'light');
  } catch {
    /* storage disabled */
  }
}

export function CommandPalette() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { recent, pinned, record, clearRecent, togglePin, isPinned } =
    useSearchHistory();

  const { data: searchData, isLoading } = useSearch(query);

  // Persist searches once results come back, so the recent list reflects
  // queries that actually returned something. Prevents typos and single-char
  // scratches from polluting history.
  useEffect(() => {
    if (searchData && searchData.results.length > 0 && query.trim().length >= 2) {
      record(query);
    }
  }, [searchData, query, record]);

  const navigate = useCallback(
    (path: string) => {
      setOpen(false);
      setQuery('');
      router.push(path);
    },
    [router],
  );

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      { id: 'nav-dashboard', label: 'Go to Dashboard', icon: BarChart3, section: 'Navigation', action: () => navigate('/dashboard'), keywords: 'home overview' },
      { id: 'nav-ai', label: 'Go to AI Assistant', icon: Bot, section: 'Navigation', action: () => navigate('/ai'), keywords: 'chat gemini' },
      { id: 'nav-tutors', label: 'Go to AI Tutors', icon: GraduationCap, section: 'Navigation', action: () => navigate('/tutors'), keywords: 'subject learn' },
      { id: 'nav-assignments', label: 'Go to Assignments', icon: CheckSquare, section: 'Navigation', action: () => navigate('/assignments'), keywords: 'tasks homework' },
      { id: 'nav-schedule', label: 'Go to Schedule', icon: CalendarDays, section: 'Navigation', action: () => navigate('/schedule'), keywords: 'calendar timetable' },
      { id: 'nav-notes', label: 'Go to Notes', icon: BookOpen, section: 'Navigation', action: () => navigate('/notes'), keywords: 'documents writing' },
      { id: 'nav-flashcards', label: 'Go to Flashcards', icon: Layers, section: 'Navigation', action: () => navigate('/flashcards'), keywords: 'review cards' },
      { id: 'nav-focus', label: 'Go to Focus', icon: Timer, section: 'Navigation', action: () => navigate('/focus'), keywords: 'pomodoro timer study' },
      { id: 'nav-analytics', label: 'Go to Analytics', icon: TrendingUp, section: 'Navigation', action: () => navigate('/analytics'), keywords: 'stats progress' },
      { id: 'nav-groups', label: 'Go to Groups', icon: Users, section: 'Navigation', action: () => navigate('/groups'), keywords: 'study group chat' },
      { id: 'nav-settings', label: 'Go to Settings', icon: Settings, section: 'Navigation', action: () => navigate('/settings'), keywords: 'preferences profile' },
      { id: 'nav-pdf', label: 'Open PDF Reader', icon: FileText, section: 'Navigation', action: () => navigate('/pdf-reader'), keywords: 'read document' },
      { id: 'nav-knowledge', label: 'Open Knowledge Base', icon: BookOpen, section: 'Navigation', action: () => navigate('/knowledge'), keywords: 'files documents ask' },
      { id: 'nav-ai-tools', label: 'Open AI Tools', icon: Wrench, section: 'Navigation', action: () => navigate('/ai/tools'), keywords: 'utilities toolkit' },
      { id: 'nav-achievements', label: 'Go to Achievements', icon: Target, section: 'Navigation', action: () => navigate('/achievements'), keywords: 'badges xp gamification' },
      { id: 'nav-timeline', label: 'Open Study Timeline', icon: Clock, section: 'Navigation', action: () => navigate('/timeline'), keywords: 'history activity feed' },
      { id: 'nav-replay', label: 'Open Yearly Replay', icon: Sparkles, section: 'Navigation', action: () => navigate('/replay'), keywords: 'wrapped recap year' },
      { id: 'act-new-assignment', label: 'Create Assignment', icon: Plus, section: 'Actions', action: () => navigate('/assignments?new=1'), keywords: 'add task homework' },
      { id: 'act-new-note', label: 'Create Note', icon: Plus, section: 'Actions', action: () => navigate('/notes?new=1'), keywords: 'add document' },
      { id: 'act-new-flashcard', label: 'Create Flashcard Deck', icon: Plus, section: 'Actions', action: () => navigate('/flashcards?new=1'), keywords: 'add deck study cards' },
      { id: 'act-new-group', label: 'Create Study Group', icon: Plus, section: 'Actions', action: () => navigate('/groups?new=1'), keywords: 'add team collaborate' },
      { id: 'act-ask-ai', label: 'Ask AI', icon: Bot, section: 'Actions', action: () => navigate('/ai'), keywords: 'question help' },
      { id: 'act-focus', label: 'Start Focus Session', icon: Zap, section: 'Actions', action: () => navigate('/focus'), keywords: 'pomodoro timer concentrate' },
      { id: 'act-timer', label: 'Start Timer', icon: Timer, section: 'Actions', action: () => navigate('/focus?timer=1'), keywords: 'pomodoro stopwatch countdown' },
      { id: 'act-theme', label: 'Toggle Dark Mode', icon: typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? Sun : Moon, section: 'Preferences', action: () => { toggleTheme(); setOpen(false); }, keywords: 'theme light dark mode' },
      { id: 'act-logout', label: 'Sign Out', icon: LogOut, section: 'Account', action: () => { void logout().then(() => router.replace('/login')); setOpen(false); }, keywords: 'logout exit' },
    ];
    return cmds;
  }, [navigate, logout, router]);

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;
    const lower = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(lower) ||
        cmd.keywords?.toLowerCase().includes(lower) ||
        cmd.section.toLowerCase().includes(lower),
    );
  }, [commands, query]);

  // Stable reference so the keydown handler's deps don't change every render.
  const searchResults = useMemo(() => searchData?.results ?? [], [searchData]);
  const totalItems = filteredCommands.length + searchResults.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, totalItems - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex < filteredCommands.length) {
          filteredCommands[activeIndex]?.action();
        } else {
          const result = searchResults[activeIndex - filteredCommands.length];
          if (result) {
            setOpen(false);
            setQuery('');
            router.push(result.url);
          }
        }
      }
    },
    [activeIndex, filteredCommands, searchResults, totalItems, router],
  );

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const renderItem = (
    key: string,
    index: number,
    icon: React.ReactNode,
    label: React.ReactNode,
    subtitle: React.ReactNode,
    badge: string | null,
    badgeColor: string | null,
    onClick: () => void,
  ) => (
    <button
      key={key}
      data-index={index}
      type="button"
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
        activeIndex === index
          ? 'bg-brand/12 text-brand-bright'
          : 'text-fg hover:bg-surface-raised',
      )}
      onClick={onClick}
      onMouseEnter={() => setActiveIndex(index)}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-fg-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {subtitle ? (
          <span className="block truncate text-xs text-fg-subtle">{subtitle}</span>
        ) : null}
      </span>
      {badge ? (
        <span
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
          style={{
            backgroundColor: badgeColor ? `${badgeColor}20` : undefined,
            color: badgeColor ?? undefined,
          }}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );

  let itemIndex = 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-xl border border-border bg-surface-raised/60 px-3 py-1.5 text-sm text-fg-subtle transition-colors hover:border-brand/40 hover:text-fg lg:flex"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search...</span>
        <kbd className="ml-4 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium text-fg-subtle">
          Ctrl K
        </kbd>
      </button>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-surface-raised/60 text-fg-subtle transition-colors hover:text-fg lg:hidden"
        aria-label="Search"
      >
        <Search className="h-4 w-4" />
      </button>

      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
            <motion.div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setOpen(false); setQuery(''); }}
            />
            <motion.div
              className="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
              initial={{ opacity: 0, scale: 0.95, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              transition={{ type: 'spring', stiffness: 500, damping: 36 }}
            >
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <Search className="h-4 w-4 shrink-0 text-fg-subtle" />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search everything or type a command..."
                  className="min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-fg-subtle" />
                ) : null}
                <kbd className="rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-fg-subtle">
                  ESC
                </kbd>
              </div>

              <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
                {/* Commands grouped by section */}
                {(() => {
                  const sections = new Map<string, Command[]>();
                  for (const cmd of filteredCommands) {
                    const arr = sections.get(cmd.section) ?? [];
                    arr.push(cmd);
                    sections.set(cmd.section, arr);
                  }
                  const nodes: React.ReactNode[] = [];
                  for (const [section, cmds] of sections) {
                    nodes.push(
                      <div key={section} className="mb-1 px-2 pt-2 text-[10px] font-semibold uppercase tracking-widest text-fg-subtle">
                        {section}
                      </div>,
                    );
                    for (const cmd of cmds) {
                      const idx = itemIndex++;
                      nodes.push(
                        renderItem(
                          cmd.id,
                          idx,
                          <cmd.icon className="h-4 w-4" />,
                          cmd.label,
                          null,
                          null,
                          null,
                          cmd.action,
                        ),
                      );
                    }
                  }
                  return nodes;
                })()}

                {/* Search results — only when the user is actively querying.
                    Without the query guard, react-query's placeholderData keeps
                    the last result set visible after Escape, which collides with
                    the empty-state Recent/Pinned lists below. */}
                {query.trim() && searchResults.length > 0 ? (
                  <>
                    <div className="mt-3 mb-1 flex items-center justify-between px-2 text-[10px] font-semibold uppercase tracking-widest text-fg-subtle">
                      <span>Search Results</span>
                      {query.trim() ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePin(query);
                          }}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-fg-subtle transition-colors hover:bg-surface-raised hover:text-fg"
                          aria-label={isPinned(query) ? 'Unpin query' : 'Pin query'}
                        >
                          {isPinned(query) ? (
                            <>
                              <PinOff className="h-3 w-3" /> Unpin
                            </>
                          ) : (
                            <>
                              <Pin className="h-3 w-3" /> Pin
                            </>
                          )}
                        </button>
                      ) : null}
                    </div>
                    {searchResults.map((r) => {
                      const idx = itemIndex++;
                      const Icon = CATEGORY_ICONS[r.category] ?? FileText;
                      return renderItem(
                        `sr-${r.id}`,
                        idx,
                        r.icon ? (
                          <span className="text-base">{r.icon}</span>
                        ) : (
                          <Icon className="h-4 w-4" />
                        ),
                        <HighlightedText text={r.title} ranges={r.titleHighlights} />,
                        r.excerpt ? (
                          <HighlightedText text={r.excerpt} ranges={r.excerptHighlights} />
                        ) : (
                          r.subtitle
                        ),
                        CATEGORY_LABELS[r.category],
                        r.color,
                        () => {
                          setOpen(false);
                          setQuery('');
                          router.push(r.url);
                        },
                      );
                    })}
                  </>
                ) : null}

                {query.trim() && !isLoading && filteredCommands.length === 0 && searchResults.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-fg-subtle">
                    <Search className="h-8 w-8 opacity-40" />
                    <p className="text-sm">No results for &ldquo;{query}&rdquo;</p>
                  </div>
                ) : null}

                {/* Recent + pinned searches — shown only on an empty query */}
                {!query.trim() && (pinned.length > 0 || recent.length > 0) ? (
                  <div className="mt-2 border-t border-border pt-2">
                    {pinned.length > 0 ? (
                      <>
                        <div className="mb-1 px-2 pt-1 text-[10px] font-semibold uppercase tracking-widest text-fg-subtle">
                          Pinned
                        </div>
                        {pinned.map((q) => (
                          <button
                            key={`pin-${q}`}
                            type="button"
                            onClick={() => setQuery(q)}
                            className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-fg transition-colors hover:bg-surface-raised"
                          >
                            <Pin className="h-3.5 w-3.5 text-brand" />
                            <span className="min-w-0 flex-1 truncate">{q}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePin(q);
                              }}
                              className="rounded p-1 text-fg-subtle opacity-0 transition-opacity hover:bg-surface hover:text-fg group-hover:opacity-100"
                              aria-label="Unpin"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </button>
                        ))}
                      </>
                    ) : null}
                    {recent.length > 0 ? (
                      <>
                        <div className="mt-2 mb-1 flex items-center justify-between px-2 pt-1 text-[10px] font-semibold uppercase tracking-widest text-fg-subtle">
                          <span>Recent</span>
                          <button
                            type="button"
                            onClick={clearRecent}
                            className="rounded px-1.5 py-0.5 normal-case tracking-normal text-fg-subtle transition-colors hover:bg-surface-raised hover:text-fg"
                          >
                            Clear
                          </button>
                        </div>
                        {recent.map((q) => (
                          <button
                            key={`rec-${q}`}
                            type="button"
                            onClick={() => setQuery(q)}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-fg transition-colors hover:bg-surface-raised"
                          >
                            <Clock className="h-3.5 w-3.5 text-fg-subtle" />
                            <span className="min-w-0 flex-1 truncate">{q}</span>
                          </button>
                        ))}
                      </>
                    ) : null}
                  </div>
                ) : null}

                {!query.trim() && filteredCommands.length === 0 && pinned.length === 0 && recent.length === 0 ? (
                  <div className="py-6 text-center text-sm text-fg-subtle">
                    Start typing to search...
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[10px] text-fg-subtle">
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-border px-1 py-0.5">↑↓</kbd> Navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-border px-1 py-0.5">↵</kbd> Select
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-border px-1 py-0.5">Esc</kbd> Close
                </span>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
