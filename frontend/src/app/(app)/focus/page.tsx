'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Coffee, Maximize2, Minimize2, Pause, Play, Square, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useActiveSession,
  useCancelSession,
  useEndSession,
  useFocusSessions,
  useStartSession,
} from '@/hooks/use-schedule';
import { useSubjects } from '@/hooks/use-dashboard';
import { cn, formatMinutes } from '@/lib/utils';
import { useT } from '@/lib/i18n/provider';

type Phase = 'work' | 'break';

const PRESETS = [
  { label: 'Pomodoro', work: 25, rest: 5 },
  { label: 'Long focus', work: 50, rest: 10 },
  { label: 'Deep work', work: 90, rest: 20 },
];

function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export default function FocusPage() {
  const t = useT();
  const [presetIndex, setPresetIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('work');
  const [secondsLeft, setSecondsLeft] = useState(PRESETS[0]!.work * 60);
  const [running, setRunning] = useState(false);
  const [interruptions, setInterruptions] = useState(0);
  const [subjectId, setSubjectId] = useState<string | undefined>();
  const [immersive, setImmersive] = useState(false);
  const [completedCycles, setCompletedCycles] = useState(0);

  const preset = PRESETS[presetIndex]!;
  const totalSeconds = (phase === 'work' ? preset.work : preset.rest) * 60;

  const { data: subjects } = useSubjects();
  const { data: activeSession } = useActiveSession();
  const { data: history } = useFocusSessions(1);

  const startSession = useStartSession();
  const endSession = useEndSession();
  const cancelSession = useCancelSession();

  // Holds the server-side session id for the running work phase.
  const sessionIdRef = useRef<string | null>(null);

  // Adopt a session that survived a page reload.
  useEffect(() => {
    if (activeSession && !sessionIdRef.current) {
      sessionIdRef.current = activeSession.id;
      const elapsed = Math.floor(
        (Date.now() - new Date(activeSession.startedAt).getTime()) / 1000,
      );
      setSecondsLeft(Math.max(0, preset.work * 60 - elapsed));
      setRunning(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession]);

  const finishPhase = useCallback(() => {
    setRunning(false);

    if (phase === 'work') {
      if (sessionIdRef.current) {
        endSession.mutate({
          id: sessionIdRef.current,
          completed: true,
          interruptions,
        });
        sessionIdRef.current = null;
      }
      setCompletedCycles((count) => count + 1);
      setInterruptions(0);
      setPhase('break');
      setSecondsLeft(preset.rest * 60);
    } else {
      setPhase('work');
      setSecondsLeft(preset.work * 60);
    }

    // A short chime would go here; skipped rather than shipping a silent stub.
  }, [phase, preset, interruptions, endSession]);

  // The countdown. Recomputed each tick from a deadline would be more accurate
  // across tab suspension, but for a visible timer a 1s interval is adequate
  // and the authoritative duration is measured server-side anyway.
  useEffect(() => {
    if (!running) return;

    const timer = setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          finishPhase();
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [running, finishPhase]);

  async function handleStart() {
    if (phase === 'work' && !sessionIdRef.current) {
      const session = await startSession.mutateAsync({
        type: preset.work >= 60 ? 'DEEP_WORK' : 'POMODORO',
        subjectId: subjectId ?? null,
      });
      sessionIdRef.current = session.id;
    }
    setRunning(true);
  }

  function handlePause() {
    setRunning(false);
    setInterruptions((count) => count + 1);
  }

  function handleStop() {
    setRunning(false);

    if (sessionIdRef.current) {
      const elapsed = totalSeconds - secondsLeft;
      // Under a minute is treated as a false start and discarded rather than
      // polluting the stats with a near-zero session.
      if (elapsed < 60) {
        cancelSession.mutate(sessionIdRef.current);
      } else {
        endSession.mutate({
          id: sessionIdRef.current,
          completed: false,
          interruptions,
        });
      }
      sessionIdRef.current = null;
    }

    setPhase('work');
    setSecondsLeft(preset.work * 60);
    setInterruptions(0);
  }

  const progress = totalSeconds === 0 ? 0 : 1 - secondsLeft / totalSeconds;
  const circumference = 2 * Math.PI * 120;

  const timer = (
    <div className="flex flex-col items-center">
      <div className="relative grid place-items-center">
        <svg width="280" height="280" viewBox="0 0 280 280" className="-rotate-90">
          <circle
            cx="140"
            cy="140"
            r="120"
            fill="none"
            stroke="var(--color-surface-raised)"
            strokeWidth="10"
          />
          <circle
            cx="140"
            cy="140"
            r="120"
            fill="none"
            stroke={phase === 'work' ? 'var(--color-brand)' : 'var(--color-teal)'}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        </svg>

        <div className="absolute text-center">
          <p className="text-6xl font-semibold tabular-nums tracking-tight">
            {formatClock(secondsLeft)}
          </p>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-fg-muted">
            {phase === 'work' ? (
              <>
                <Timer className="h-4 w-4" aria-hidden />
                Focus
              </>
            ) : (
              <>
                <Coffee className="h-4 w-4" aria-hidden />
                Break
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mt-8 flex items-center gap-2">
        {running ? (
          <Button size="lg" variant="secondary" onClick={handlePause}>
            <Pause className="h-4 w-4" aria-hidden />
            Pause
          </Button>
        ) : (
          <Button size="lg" loading={startSession.isPending} onClick={() => void handleStart()}>
            <Play className="h-4 w-4" aria-hidden />
            {secondsLeft === totalSeconds ? 'Start' : 'Resume'}
          </Button>
        )}

        <Button size="lg" variant="ghost" onClick={handleStop}>
          <Square className="h-4 w-4" aria-hidden />
          Stop
        </Button>

        <Button
          size="icon"
          variant="ghost"
          aria-label={immersive ? 'Exit full screen' : 'Full screen'}
          onClick={() => setImmersive((open) => !open)}
        >
          {immersive ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      </div>

      {(completedCycles > 0 || interruptions > 0) && (
        <p className="mt-4 text-sm text-fg-subtle">
          {completedCycles} session{completedCycles === 1 ? '' : 's'} today
          {interruptions > 0 ? ` · ${interruptions} interruption${interruptions === 1 ? '' : 's'}` : ''}
        </p>
      )}
    </div>
  );

  if (immersive) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-canvas">{timer}</div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('focus.title')}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {t('focus.subtitle')}
        </p>
      </header>

      <Card className="py-10">{timer}</Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Session length</CardTitle>
          </CardHeader>

          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((option, index) => (
              <button
                key={option.label}
                type="button"
                disabled={running}
                aria-pressed={presetIndex === index}
                onClick={() => {
                  setPresetIndex(index);
                  setPhase('work');
                  setSecondsLeft(option.work * 60);
                }}
                className={cn(
                  'rounded-xl border p-3 text-center transition-colors disabled:opacity-50',
                  presetIndex === index
                    ? 'border-brand bg-brand/12 text-brand-bright'
                    : 'border-border text-fg-muted hover:border-border-strong',
                )}
              >
                <p className="text-sm font-medium">{option.label}</p>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  {option.work}m / {option.rest}m
                </p>
              </button>
            ))}
          </div>

          {subjects && subjects.length > 0 ? (
            <div className="mt-4">
              <label
                htmlFor="focus-subject"
                className="mb-1.5 block text-sm font-medium text-fg-muted"
              >
                Link to a subject
              </label>
              <select
                id="focus-subject"
                value={subjectId ?? ''}
                disabled={running}
                onChange={(event) => setSubjectId(event.target.value || undefined)}
                className="h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm focus:border-brand focus:outline-none disabled:opacity-50"
              >
                <option value="">No subject</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent sessions</CardTitle>
          </CardHeader>

          {!history || history.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">
              No sessions recorded yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {history.items.slice(0, 6).map((session) => (
                <li
                  key={session.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised/60 p-2.5 text-sm"
                >
                  <span
                    className="h-8 w-1 shrink-0 rounded-full"
                    style={{
                      backgroundColor: session.subject?.color ?? 'var(--color-brand)',
                    }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      {session.subject?.name ?? session.type.replace('_', ' ').toLowerCase()}
                    </p>
                    <p className="text-xs text-fg-subtle">
                      {new Date(session.startedAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <span className="shrink-0 tabular-nums text-xs text-fg-subtle">
                    {formatMinutes(Math.round(session.durationSeconds / 60))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
