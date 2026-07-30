import { describe, expect, it } from 'vitest';
import {
  allocateSessions,
  calculateStreak,
  detectBurnoutRisk,
  durationMinutes,
  expandRecurrence,
  findConflicts,
  findFreeSlots,
  mergeBlocks,
  overlaps,
  prioritiseTasks,
  type StudyTask,
  type TimeBlock,
} from './scheduling';

/** Builds a block on a fixed day from "HH:MM" strings. */
function block(start: string, end: string): TimeBlock {
  return {
    startAt: new Date(`2026-03-02T${start}:00.000Z`),
    endAt: new Date(`2026-03-02T${end}:00.000Z`),
  };
}

function hhmm(date: Date): string {
  return date.toISOString().slice(11, 16);
}

describe('overlap detection', () => {
  it('detects a partial overlap', () => {
    expect(overlaps(block('09:00', '10:00'), block('09:30', '10:30'))).toBe(true);
  });

  it('detects full containment', () => {
    expect(overlaps(block('09:00', '12:00'), block('10:00', '11:00'))).toBe(true);
  });

  it('treats back-to-back blocks as non-conflicting', () => {
    // 09:00-10:00 and 10:00-11:00 must be allowed.
    expect(overlaps(block('09:00', '10:00'), block('10:00', '11:00'))).toBe(false);
  });

  it('ignores disjoint blocks', () => {
    expect(overlaps(block('09:00', '10:00'), block('14:00', '15:00'))).toBe(false);
  });

  it('is symmetric', () => {
    const a = block('09:00', '11:00');
    const b = block('10:00', '12:00');
    expect(overlaps(a, b)).toBe(overlaps(b, a));
  });

  it('returns every conflicting block', () => {
    const existing = [block('09:00', '10:00'), block('10:30', '11:30'), block('15:00', '16:00')];
    const conflicts = findConflicts(block('09:30', '11:00'), existing);
    expect(conflicts).toHaveLength(2);
  });
});

describe('block merging', () => {
  it('merges overlapping blocks', () => {
    const merged = mergeBlocks([block('09:00', '10:30'), block('10:00', '11:00')]);
    expect(merged).toHaveLength(1);
    expect(hhmm(merged[0]!.startAt)).toBe('09:00');
    expect(hhmm(merged[0]!.endAt)).toBe('11:00');
  });

  it('merges adjacent blocks', () => {
    expect(mergeBlocks([block('09:00', '10:00'), block('10:00', '11:00')])).toHaveLength(1);
  });

  it('keeps disjoint blocks separate', () => {
    expect(mergeBlocks([block('09:00', '10:00'), block('14:00', '15:00')])).toHaveLength(2);
  });

  it('absorbs a fully contained block', () => {
    const merged = mergeBlocks([block('09:00', '17:00'), block('11:00', '12:00')]);
    expect(merged).toHaveLength(1);
    expect(hhmm(merged[0]!.endAt)).toBe('17:00');
  });

  it('handles unsorted input', () => {
    const merged = mergeBlocks([block('14:00', '15:00'), block('09:00', '10:00')]);
    expect(hhmm(merged[0]!.startAt)).toBe('09:00');
  });

  it('returns an empty list for no input', () => {
    expect(mergeBlocks([])).toEqual([]);
  });
});

describe('free slot detection', () => {
  it('finds the gap between two commitments', () => {
    const free = findFreeSlots(block('09:00', '17:00'), [
      block('09:00', '11:00'),
      block('14:00', '15:00'),
    ]);

    expect(free).toHaveLength(2);
    expect(hhmm(free[0]!.startAt)).toBe('11:00');
    expect(hhmm(free[0]!.endAt)).toBe('14:00');
    expect(hhmm(free[1]!.startAt)).toBe('15:00');
  });

  it('returns the whole window when nothing is booked', () => {
    const free = findFreeSlots(block('09:00', '17:00'), []);
    expect(free).toHaveLength(1);
    expect(durationMinutes(free[0]!)).toBe(480);
  });

  it('returns nothing when the window is fully booked', () => {
    expect(findFreeSlots(block('09:00', '17:00'), [block('08:00', '18:00')])).toEqual([]);
  });

  it('discards gaps below the minimum length', () => {
    const free = findFreeSlots(
      block('09:00', '17:00'),
      [block('09:00', '11:00'), block('11:10', '17:00')],
      15,
    );
    // The 10-minute gap is unusable.
    expect(free).toEqual([]);
  });

  it('ignores commitments outside the window', () => {
    const free = findFreeSlots(block('09:00', '12:00'), [block('14:00', '15:00')]);
    expect(free).toHaveLength(1);
    expect(durationMinutes(free[0]!)).toBe(180);
  });
});

describe('task prioritisation', () => {
  function task(id: string, overrides: Partial<StudyTask> = {}): StudyTask {
    return {
      id,
      title: id,
      estimatedMinutes: 60,
      dueAt: null,
      priority: 'MEDIUM',
      ...overrides,
    };
  }

  it('puts earlier deadlines first', () => {
    const ordered = prioritiseTasks([
      task('later', { dueAt: new Date('2026-03-10') }),
      task('sooner', { dueAt: new Date('2026-03-03') }),
    ]);
    expect(ordered[0]?.id).toBe('sooner');
  });

  it('sorts undated tasks after dated ones', () => {
    const ordered = prioritiseTasks([
      task('undated'),
      task('dated', { dueAt: new Date('2026-03-10') }),
    ]);
    expect(ordered[0]?.id).toBe('dated');
  });

  it('falls back to priority when neither has a deadline', () => {
    const ordered = prioritiseTasks([
      task('low', { priority: 'LOW' }),
      task('urgent', { priority: 'URGENT' }),
      task('medium', { priority: 'MEDIUM' }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['urgent', 'medium', 'low']);
  });
});

describe('session allocation', () => {
  const options = { maxSessionMinutes: 50, minSessionMinutes: 25, breakMinutes: 10 };

  function task(id: string, minutes: number, overrides: Partial<StudyTask> = {}): StudyTask {
    return {
      id,
      title: id,
      estimatedMinutes: minutes,
      dueAt: null,
      priority: 'MEDIUM',
      ...overrides,
    };
  }

  it('places a task that fits in one sitting', () => {
    const { sessions, unscheduled } = allocateSessions(
      [task('essay', 50)],
      [block('09:00', '11:00')],
      options,
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.minutes).toBe(50);
    expect(unscheduled).toEqual([]);
  });

  it('splits long work across multiple sittings', () => {
    const { sessions } = allocateSessions(
      [task('revision', 120)],
      [block('09:00', '14:00')],
      options,
    );

    expect(sessions.length).toBeGreaterThan(1);
    expect(sessions.reduce((sum, entry) => sum + entry.minutes, 0)).toBe(120);
    expect(sessions.every((entry) => entry.minutes <= options.maxSessionMinutes)).toBe(true);
  });

  it('inserts breaks between consecutive sittings', () => {
    const { sessions } = allocateSessions(
      [task('revision', 100)],
      [block('09:00', '14:00')],
      options,
    );

    const [first, second] = sessions;
    const gap = (second!.startAt.getTime() - first!.endAt.getTime()) / 60000;
    expect(gap).toBe(options.breakMinutes);
  });

  it('never produces overlapping sessions', () => {
    const { sessions } = allocateSessions(
      [task('a', 90), task('b', 90), task('c', 60)],
      [block('09:00', '13:00'), block('14:00', '18:00')],
      options,
    );

    for (let i = 0; i < sessions.length; i += 1) {
      for (let j = i + 1; j < sessions.length; j += 1) {
        expect(overlaps(sessions[i]!, sessions[j]!)).toBe(false);
      }
    }
  });

  it('keeps every session inside its free slot', () => {
    const slots = [block('09:00', '11:00'), block('14:00', '16:00')];
    const { sessions } = allocateSessions([task('a', 200)], slots, options);

    for (const session of sessions) {
      const containing = slots.find(
        (slot) => session.startAt >= slot.startAt && session.endAt <= slot.endAt,
      );
      expect(containing).toBeDefined();
    }
  });

  it('reports work it could not place at all', () => {
    const { sessions, unscheduled } = allocateSessions(
      [task('big', 60), task('nofit', 60)],
      [block('09:00', '10:00')],
      options,
    );

    expect(sessions).toHaveLength(1);
    expect(unscheduled.map((entry) => entry.id)).toEqual(['nofit']);
  });

  it('schedules the most urgent task first', () => {
    const { sessions } = allocateSessions(
      [
        task('later', 50, { dueAt: new Date('2026-03-20') }),
        task('urgent', 50, { dueAt: new Date('2026-03-03') }),
      ],
      [block('09:00', '11:00')],
      options,
    );

    expect(sessions[0]?.taskId).toBe('urgent');
  });

  it('schedules the full estimate, including a short final remainder', () => {
    // Regression guard: 120 minutes at 50/sitting leaves a 20-minute tail,
    // which is below minSessionMinutes but must still be scheduled rather
    // than silently dropped.
    const { sessions, unscheduled } = allocateSessions(
      [task('revision', 120)],
      [block('09:00', '14:00')],
      options,
    );

    expect(sessions.reduce((sum, entry) => sum + entry.minutes, 0)).toBe(120);
    expect(unscheduled).toEqual([]);
  });

  it.each([45, 70, 115, 130, 200])(
    'schedules every minute of a %i-minute task when capacity allows',
    (minutes) => {
      const { sessions } = allocateSessions(
        [task('work', minutes)],
        [block('09:00', '18:00')],
        options,
      );
      expect(sessions.reduce((sum, entry) => sum + entry.minutes, 0)).toBe(minutes);
    },
  );

  it('only splits below the minimum for a task tail, never mid-task', () => {
    const { sessions } = allocateSessions([task('a', 130)], [block('09:00', '18:00')], options);

    // Every sitting except possibly the last respects the floor.
    const allButLast = sessions.slice(0, -1);
    expect(allButLast.every((entry) => entry.minutes >= options.minSessionMinutes)).toBe(true);
  });
});

describe('recurrence expansion', () => {
  it('expands a weekly block through the end of the final day', () => {
    // `until` is compared against each occurrence's start instant, so callers
    // pass end-of-day to include that day. Mar 2, 9, 16, 23, 30.
    const occurrences = expandRecurrence(
      block('09:00', '10:00'),
      'WEEKLY',
      new Date('2026-03-30T23:59:59.999Z'),
    );
    expect(occurrences).toHaveLength(5);
  });

  it('excludes an occurrence starting after the until instant', () => {
    // until = Mar 30 00:00 excludes the 09:00 occurrence on Mar 30.
    const occurrences = expandRecurrence(
      block('09:00', '10:00'),
      'WEEKLY',
      new Date('2026-03-30T00:00:00.000Z'),
    );
    expect(occurrences).toHaveLength(4);
  });

  it('preserves the block duration', () => {
    const occurrences = expandRecurrence(
      block('09:00', '10:30'),
      'DAILY',
      new Date('2026-03-05T00:00:00.000Z'),
    );
    expect(occurrences.every((entry) => durationMinutes(entry) === 90)).toBe(true);
  });

  it('respects the occurrence cap', () => {
    const occurrences = expandRecurrence(
      block('09:00', '10:00'),
      'DAILY',
      new Date('2030-01-01T00:00:00.000Z'),
      10,
    );
    expect(occurrences).toHaveLength(10);
  });

  it('returns a single occurrence when the end date is the start date', () => {
    const occurrences = expandRecurrence(
      block('09:00', '10:00'),
      'WEEKLY',
      new Date('2026-03-02T09:00:00.000Z'),
    );
    expect(occurrences).toHaveLength(1);
  });
});

describe('burnout detection', () => {
  it('stays quiet without enough history', () => {
    expect(detectBurnoutRisk([300, 300]).atRisk).toBe(false);
  });

  it('flags a fortnight with no rest day at high volume', () => {
    const result = detectBurnoutRisk(Array.from({ length: 16 }, () => 300));
    expect(result.atRisk).toBe(true);
    expect(result.consecutiveDays).toBeGreaterThanOrEqual(14);
  });

  it('flags an extreme weekly average', () => {
    expect(detectBurnoutRisk([480, 480, 480, 480, 480, 480, 480]).atRisk).toBe(true);
  });

  it('does not flag sustainable study', () => {
    expect(detectBurnoutRisk([120, 90, 0, 150, 60, 0, 120]).atRisk).toBe(false);
  });

  it('resets the consecutive count on a rest day', () => {
    expect(detectBurnoutRisk([200, 200, 200, 0, 200, 200]).consecutiveDays).toBe(2);
  });
});

describe('streak calculation', () => {
  it('counts consecutive days ending today', () => {
    expect(calculateStreak(['2026-03-01', '2026-03-02', '2026-03-03'], '2026-03-03')).toBe(3);
  });

  it('keeps the streak alive when today has no activity yet', () => {
    // Studied through yesterday; today is still in progress.
    expect(calculateStreak(['2026-03-01', '2026-03-02'], '2026-03-03')).toBe(2);
  });

  it('breaks after a full missed day', () => {
    expect(calculateStreak(['2026-03-01'], '2026-03-03')).toBe(0);
  });

  it('ignores activity before a gap', () => {
    expect(
      calculateStreak(['2026-02-01', '2026-02-02', '2026-03-02', '2026-03-03'], '2026-03-03'),
    ).toBe(2);
  });

  it('returns zero with no activity', () => {
    expect(calculateStreak([], '2026-03-03')).toBe(0);
  });

  it('counts a single active day', () => {
    expect(calculateStreak(['2026-03-03'], '2026-03-03')).toBe(1);
  });
});
