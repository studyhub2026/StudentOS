'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowRight,
  CheckSquare,
  Eye,
  EyeOff,
  Flame,
  GripVertical,
  Layers,
  LayoutGrid,
  Pencil,
  Save,
  Sparkles,
  Timer,
  Target,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDashboard } from '@/hooks/use-dashboard';
import { useGamification } from '@/hooks/use-gamification';
import { apiClient, apiErrorMessage } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type WidgetKey =
  | 'brief'
  | 'stats'
  | 'priorities'
  | 'streak'
  | 'quickActions'
  | 'weekly'
  | 'gamification';

interface WidgetLayoutEntry {
  key: WidgetKey;
  hidden?: boolean;
}

interface AccountSettings {
  profilePublic: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
  dashboardLayout: WidgetLayoutEntry[] | null;
  bio: string | null;
}

const DEFAULT_LAYOUT: WidgetLayoutEntry[] = [
  { key: 'brief' },
  { key: 'stats' },
  { key: 'priorities' },
  { key: 'streak' },
  { key: 'quickActions' },
  { key: 'weekly' },
  { key: 'gamification' },
];

const WIDGET_META: Record<WidgetKey, { title: string; icon: React.ComponentType<{ className?: string }>; span: 'small' | 'medium' | 'large' }> = {
  brief:         { title: "Today's brief",     icon: Sparkles,   span: 'large' },
  stats:         { title: 'This week',         icon: TrendingUp, span: 'medium' },
  priorities:    { title: 'Up next',           icon: Target,     span: 'medium' },
  streak:        { title: 'Streak',            icon: Flame,      span: 'small' },
  quickActions:  { title: 'Quick actions',     icon: LayoutGrid, span: 'medium' },
  weekly:        { title: 'Weekly workload',   icon: CheckSquare, span: 'small' },
  gamification:  { title: 'XP & Level',        icon: Trophy,     span: 'small' },
};

const SPAN_CLASS: Record<'small' | 'medium' | 'large', string> = {
  small:  'sm:col-span-1',
  medium: 'sm:col-span-1 lg:col-span-2',
  large:  'sm:col-span-2 lg:col-span-3',
};

export default function CustomDashboardPage() {
  const { data, isLoading } = useDashboard();
  const { data: gamification } = useGamification();
  const [layout, setLayout] = useState<WidgetLayoutEntry[]>(DEFAULT_LAYOUT);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Pull settings once on mount to hydrate the layout.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: res } = await apiClient.get<ApiEnvelope<AccountSettings>>('/auth/settings');
        if (cancelled) return;
        const stored = res.data.dashboardLayout;
        if (Array.isArray(stored) && stored.length > 0) {
          // Merge stored order with any new widgets that were added since.
          const known = new Set(DEFAULT_LAYOUT.map((w) => w.key));
          const filtered = stored.filter((w): w is WidgetLayoutEntry => known.has(w.key as WidgetKey));
          const missing = DEFAULT_LAYOUT.filter(
            (d) => !filtered.some((s) => s.key === d.key),
          );
          setLayout([...filtered, ...missing]);
        }
      } catch (error) {
        toast.error(apiErrorMessage(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLayout((prev) => {
      const oldIndex = prev.findIndex((w) => w.key === active.id);
      const newIndex = prev.findIndex((w) => w.key === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function toggleHidden(key: WidgetKey) {
    setLayout((prev) => prev.map((w) => (w.key === key ? { ...w, hidden: !w.hidden } : w)));
  }

  async function saveLayout() {
    setSaving(true);
    try {
      await apiClient.patch('/auth/settings', { dashboardLayout: layout });
      toast.success('Layout saved');
      setEditing(false);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function resetLayout() {
    setLayout(DEFAULT_LAYOUT);
  }

  const visible = useMemo(() => layout.filter((w) => !w.hidden), [layout]);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <LayoutGrid className="h-5 w-5 text-brand-bright" aria-hidden />
            Custom Dashboard
          </h1>
          <p className="text-sm text-fg-muted">
            Reorder or hide widgets. Layout is saved to your account.{' '}
            <Link href="/dashboard" className="text-brand-bright hover:underline">
              Back to default
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Button variant="ghost" onClick={resetLayout} disabled={saving}>
                Reset
              </Button>
              <Button onClick={() => void saveLayout()} disabled={saving}>
                <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save layout'}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> Edit layout
            </Button>
          )}
        </div>
      </header>

      {editing ? (
        <Card className="p-3 text-xs text-fg-muted">
          Drag by the handle to reorder. Toggle the eye to hide a widget.
        </Card>
      ) : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visible.map((w) => w.key)} strategy={rectSortingStrategy}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(editing ? layout : visible).map((entry) => (
              <SortableWidget
                key={entry.key}
                entry={entry}
                editing={editing}
                onToggleHidden={() => toggleHidden(entry.key)}
              >
                <WidgetBody
                  keyName={entry.key}
                  loading={isLoading}
                  data={data ?? null}
                  gamification={gamification ?? null}
                />
              </SortableWidget>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableWidget({
  entry,
  editing,
  onToggleHidden,
  children,
}: {
  entry: WidgetLayoutEntry;
  editing: boolean;
  onToggleHidden: () => void;
  children: React.ReactNode;
}) {
  const meta = WIDGET_META[entry.key];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.key,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : entry.hidden && editing ? 0.4 : 1,
  };
  const Icon = meta.icon;

  return (
    <div ref={setNodeRef} style={style} className={cn(SPAN_CLASS[meta.span])}>
      <Card className="flex h-full flex-col p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-fg-subtle">
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {meta.title}
          </p>
          {editing ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onToggleHidden}
                className="rounded p-1 text-fg-subtle hover:bg-surface-raised hover:text-fg"
                aria-label={entry.hidden ? 'Show widget' : 'Hide widget'}
              >
                {entry.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                {...attributes}
                {...listeners}
                className="cursor-grab rounded p-1 text-fg-subtle hover:bg-surface-raised hover:text-fg active:cursor-grabbing"
                aria-label={`Drag ${meta.title}`}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </div>
        <div className={cn('flex-1', entry.hidden && editing && 'pointer-events-none')}>{children}</div>
      </Card>
    </div>
  );
}

interface WidgetBodyProps {
  keyName: WidgetKey;
  loading: boolean;
  data: ReturnType<typeof useDashboard>['data'] | null;
  gamification: ReturnType<typeof useGamification>['data'] | null;
}

function WidgetBody({ keyName, loading, data, gamification }: WidgetBodyProps) {
  if (loading || !data) return <Skeleton className="h-24 w-full" />;

  switch (keyName) {
    case 'brief':
      return (
        <div>
          <p className="text-sm text-fg-muted">
            {data.assignments.dueThisWeek} due this week
            {data.assignments.overdue > 0
              ? ` — ${data.assignments.overdue} already overdue.`
              : ' — you\'re on top of things.'}
          </p>
          {data.upcoming?.length ? (
            <ul className="mt-3 space-y-1 text-sm">
              {data.upcoming.slice(0, 3).map((a) => (
                <li key={a.id} className="flex items-start gap-2">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 text-brand-bright" aria-hidden />
                  <span className="truncate">{a.title}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      );

    case 'stats':
      return (
        <div className="grid grid-cols-3 gap-4">
          <StatMini label="Study today" value={`${Math.round(data.stats.studyMinutesToday)}m`} />
          <StatMini label="Focus" value={`${data.stats.focusSessionsToday}`} />
          <StatMini label="Cards due" value={`${data.stats.cardsDueToday}`} />
        </div>
      );

    case 'priorities':
      return (
        <ul className="space-y-2 text-sm">
          {(data.upcoming?.slice(0, 4) ?? []).map((p) => (
            <li key={p.id} className="flex items-start gap-2 rounded-lg bg-surface-raised/60 p-2">
              <Target className="mt-0.5 h-3.5 w-3.5 text-brand-bright" aria-hidden />
              <div className="min-w-0">
                <p className="truncate font-medium">{p.title}</p>
                <p className="text-xs text-fg-subtle">{p.subject?.name ?? p.status}</p>
              </div>
            </li>
          ))}
          {(!data.upcoming || data.upcoming.length === 0) ? (
            <p className="text-fg-subtle">Nothing pressing. Nice.</p>
          ) : null}
        </ul>
      );

    case 'streak':
      return (
        <div className="text-center">
          <p className="text-5xl font-black tabular-nums text-warning">
            {data.stats.currentStreak}
          </p>
          <p className="mt-1 text-xs uppercase tracking-widest text-fg-subtle">Day streak</p>
        </div>
      );

    case 'quickActions':
      return (
        <div className="grid grid-cols-3 gap-2">
          <QuickAction href="/ai" label="Ask AI" icon={Sparkles} />
          <QuickAction href="/focus" label="Focus" icon={Timer} />
          <QuickAction href="/flashcards/review" label="Review" icon={Layers} />
          <QuickAction href="/notes?new=1" label="Note" icon={Pencil} />
          <QuickAction href="/whiteboard" label="Draw" icon={LayoutGrid} />
          <QuickAction href="/exam" label="Exam" icon={CheckSquare} />
        </div>
      );

    case 'weekly':
      return (
        <div className="text-center">
          <p className="text-4xl font-black tabular-nums">
            {data.assignments.dueThisWeek}
          </p>
          <p className="mt-1 text-xs uppercase tracking-widest text-fg-subtle">Due this week</p>
          {data.assignments.overdue > 0 ? (
            <p className="mt-2 text-xs text-danger">{data.assignments.overdue} overdue</p>
          ) : null}
        </div>
      );

    case 'gamification':
      return (
        <div className="text-center">
          <p className="text-4xl font-black tabular-nums text-brand-bright">
            {gamification?.level ?? 1}
          </p>
          <p className="mt-1 text-xs uppercase tracking-widest text-fg-subtle">
            Level · {gamification?.totalXp ?? 0} XP
          </p>
          {gamification ? (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: `${gamification.xpProgress.percent}%` }}
              />
            </div>
          ) : null}
        </div>
      );

    default:
      return null;
  }
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-widest text-fg-subtle">{label}</p>
    </div>
  );
}

function QuickAction({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-1 rounded-lg border border-border bg-surface-raised px-2 py-3 text-xs text-fg transition-colors hover:border-brand hover:text-brand-bright"
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </Link>
  );
}
