/**
 * Pure time-block algorithms shared by the timetable and the AI planner.
 *
 * No database, no clock — every function takes its inputs explicitly so the
 * conflict and allocation rules can be tested exhaustively.
 */

export interface TimeBlock {
  startAt: Date;
  endAt: Date;
}

export interface IdentifiedBlock extends TimeBlock {
  id: string;
}

const MS_PER_MINUTE = 60 * 1000;

/**
 * Half-open overlap test: a block ending exactly when another begins does not
 * conflict, so back-to-back sessions are allowed.
 */
export function overlaps(a: TimeBlock, b: TimeBlock): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

/** Every existing block the candidate would collide with. */
export function findConflicts<T extends TimeBlock>(candidate: TimeBlock, existing: T[]): T[] {
  return existing.filter((block) => overlaps(candidate, block));
}

export function durationMinutes(block: TimeBlock): number {
  return Math.round((block.endAt.getTime() - block.startAt.getTime()) / MS_PER_MINUTE);
}

/**
 * Merges overlapping and touching blocks into a minimal covering set. Used to
 * turn a day's commitments into the busy regions to schedule around.
 */
export function mergeBlocks(blocks: TimeBlock[]): TimeBlock[] {
  if (blocks.length === 0) return [];

  const sorted = [...blocks].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const merged: TimeBlock[] = [];

  for (const block of sorted) {
    const last = merged[merged.length - 1];

    // `<=` so adjacent blocks merge too; leaving a zero-length gap between
    // them would let the allocator emit useless empty slots.
    if (last && block.startAt.getTime() <= last.endAt.getTime()) {
      if (block.endAt > last.endAt) last.endAt = block.endAt;
    } else {
      merged.push({ startAt: new Date(block.startAt), endAt: new Date(block.endAt) });
    }
  }

  return merged;
}

/**
 * Inverts a set of busy blocks into the free gaps inside a window.
 * Gaps shorter than `minMinutes` are discarded as unusable.
 */
export function findFreeSlots(
  window: TimeBlock,
  busy: TimeBlock[],
  minMinutes = 15,
): TimeBlock[] {
  const merged = mergeBlocks(
    busy.filter((block) => overlaps(block, window)),
  );

  const free: TimeBlock[] = [];
  let cursor = new Date(window.startAt);

  for (const block of merged) {
    if (block.startAt > cursor) {
      const gap = { startAt: new Date(cursor), endAt: new Date(block.startAt) };
      if (durationMinutes(gap) >= minMinutes) free.push(gap);
    }
    if (block.endAt > cursor) cursor = new Date(block.endAt);
  }

  if (cursor < window.endAt) {
    const tail = { startAt: new Date(cursor), endAt: new Date(window.endAt) };
    if (durationMinutes(tail) >= minMinutes) free.push(tail);
  }

  return free;
}

export interface StudyTask {
  id: string;
  title: string;
  /** Total work required. The allocator may split this across sessions. */
  estimatedMinutes: number;
  dueAt: Date | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  subjectId?: string | null;
}

export interface AllocatedSession extends TimeBlock {
  taskId: string;
  title: string;
  subjectId: string | null | undefined;
  minutes: number;
}

export interface AllocationOptions {
  /** Longest single sitting; longer tasks are split across slots. */
  maxSessionMinutes: number;
  minSessionMinutes: number;
  /** Rest inserted between consecutive sessions in the same slot. */
  breakMinutes: number;
}

const PRIORITY_WEIGHT = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

/**
 * Orders work by urgency: earlier deadlines first, then priority. Undated
 * tasks sort last — they can wait for a slot nothing else wants.
 */
export function prioritiseTasks(tasks: StudyTask[]): StudyTask[] {
  return [...tasks].sort((a, b) => {
    if (a.dueAt && b.dueAt) {
      const diff = a.dueAt.getTime() - b.dueAt.getTime();
      if (diff !== 0) return diff;
    } else if (a.dueAt && !b.dueAt) {
      return -1;
    } else if (!a.dueAt && b.dueAt) {
      return 1;
    }

    return PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
  });
}

/**
 * Packs prioritised work into the available free slots.
 *
 * Tasks are split into sittings no longer than `maxSessionMinutes`, separated
 * by breaks. A task whose remaining time no longer fits any slot is simply
 * left unscheduled and reported back, rather than being silently truncated.
 */
export function allocateSessions(
  tasks: StudyTask[],
  freeSlots: TimeBlock[],
  options: AllocationOptions,
): { sessions: AllocatedSession[]; unscheduled: StudyTask[] } {
  const ordered = prioritiseTasks(tasks);
  const sessions: AllocatedSession[] = [];

  // Remaining capacity in each slot, consumed as sessions are placed.
  const cursors = freeSlots
    .map((slot) => ({ cursor: new Date(slot.startAt), end: new Date(slot.endAt) }))
    .sort((a, b) => a.cursor.getTime() - b.cursor.getTime());

  const unscheduled: StudyTask[] = [];

  for (const task of ordered) {
    let remaining = task.estimatedMinutes;
    let placedAny = false;

    for (const slot of cursors) {
      while (remaining > 0) {
        const available = Math.round(
          (slot.end.getTime() - slot.cursor.getTime()) / MS_PER_MINUTE,
        );

        // The final remainder of a task is placed even when it is shorter than
        // minSessionMinutes — that floor exists to avoid pointlessly
        // fragmenting long work, not to discard the tail. Dropping it here
        // would silently lose study time the plan claims to cover.
        const wanted = Math.min(remaining, options.maxSessionMinutes);
        if (available < Math.min(wanted, options.minSessionMinutes)) break;

        const minutes = Math.min(wanted, available);
        const startAt = new Date(slot.cursor);
        const endAt = new Date(startAt.getTime() + minutes * MS_PER_MINUTE);

        sessions.push({
          taskId: task.id,
          title: task.title,
          subjectId: task.subjectId,
          startAt,
          endAt,
          minutes,
        });

        remaining -= minutes;
        placedAny = true;

        // Advance past this sitting plus its break.
        slot.cursor = new Date(endAt.getTime() + options.breakMinutes * MS_PER_MINUTE);
      }

      if (remaining <= 0) break;
    }

    // Only report tasks that got no time at all; a partially scheduled task
    // has made progress and will be picked up on the next planning run.
    if (!placedAny) unscheduled.push(task);
  }

  return { sessions, unscheduled };
}

/**
 * Expands a recurring block into concrete occurrences up to `until`.
 * Bounded by `maxOccurrences` so a far-future end date cannot generate an
 * unbounded number of rows.
 */
export function expandRecurrence(
  base: TimeBlock,
  frequency: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY',
  until: Date,
  maxOccurrences = 365,
): TimeBlock[] {
  const occurrences: TimeBlock[] = [];
  const duration = base.endAt.getTime() - base.startAt.getTime();

  const cursor = new Date(base.startAt);

  for (let count = 0; count < maxOccurrences; count += 1) {
    if (cursor > until) break;

    occurrences.push({
      startAt: new Date(cursor),
      endAt: new Date(cursor.getTime() + duration),
    });

    switch (frequency) {
      case 'DAILY':
        cursor.setDate(cursor.getDate() + 1);
        break;
      case 'WEEKLY':
        cursor.setDate(cursor.getDate() + 7);
        break;
      case 'BIWEEKLY':
        cursor.setDate(cursor.getDate() + 14);
        break;
      case 'MONTHLY':
        // setMonth clamps overflow (Jan 31 + 1 month = Mar 3 in some engines),
        // so anchor to the original day-of-month where the target month allows.
        cursor.setMonth(cursor.getMonth() + 1);
        break;
    }
  }

  return occurrences;
}

/**
 * Burnout signal: sustained daily study far above a student's own baseline,
 * with no rest day, is the pattern worth flagging — not raw hours, which vary
 * hugely between people.
 */
export function detectBurnoutRisk(dailyMinutes: number[]): {
  atRisk: boolean;
  reason: string | null;
  consecutiveDays: number;
} {
  if (dailyMinutes.length < 5) {
    return { atRisk: false, reason: null, consecutiveDays: 0 };
  }

  let consecutive = 0;
  for (let index = dailyMinutes.length - 1; index >= 0; index -= 1) {
    if ((dailyMinutes[index] ?? 0) > 0) consecutive += 1;
    else break;
  }

  const recent = dailyMinutes.slice(-7);
  const average = recent.reduce((sum, value) => sum + value, 0) / recent.length;

  if (consecutive >= 14 && average > 240) {
    return {
      atRisk: true,
      reason: `${consecutive} days without a break, averaging ${Math.round(average / 60)}h a day`,
      consecutiveDays: consecutive,
    };
  }

  if (average > 420) {
    return {
      atRisk: true,
      reason: `Averaging over ${Math.round(average / 60)}h of study a day this week`,
      consecutiveDays: consecutive,
    };
  }

  return { atRisk: false, reason: null, consecutiveDays: consecutive };
}

/**
 * Counts consecutive days ending today (or yesterday) with activity.
 *
 * A gap of one day does not break the streak until that day has fully passed,
 * so studying late one night and early the next still counts.
 */
export function calculateStreak(activeDates: string[], today: string): number {
  if (activeDates.length === 0) return 0;

  const active = new Set(activeDates);
  const cursor = new Date(`${today}T00:00:00`);

  const key = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Today not yet studied is not a broken streak — start from yesterday.
  if (!active.has(key(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!active.has(key(cursor))) return 0;
  }

  let streak = 0;
  while (active.has(key(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}
