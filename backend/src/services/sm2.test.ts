import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EASE_FACTOR,
  MATURE_INTERVAL_DAYS,
  MIN_EASE_FACTOR,
  RATING_TO_QUALITY,
  addDays,
  initialState,
  isMature,
  previewIntervals,
  schedule,
  type ReviewQuality,
  type SchedulingState,
} from './sm2.js';

const NOW = new Date('2026-01-01T09:00:00.000Z');

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

describe('sm2 — initial state', () => {
  it('starts a card as NEW with the default ease', () => {
    const state = initialState();
    expect(state).toEqual({
      easeFactor: DEFAULT_EASE_FACTOR,
      intervalDays: 0,
      repetitions: 0,
      lapses: 0,
      state: 'NEW',
    });
  });
});

describe('sm2 — the canonical interval progression', () => {
  it('advances 1 day, then 6 days, then compounds by ease', () => {
    let state: SchedulingState = initialState();

    const first = schedule(state, 4, NOW);
    expect(first.intervalDays).toBe(1);
    expect(first.repetitions).toBe(1);

    state = first;
    const second = schedule(state, 4, NOW);
    expect(second.intervalDays).toBe(6);
    expect(second.repetitions).toBe(2);

    state = second;
    const third = schedule(state, 4, NOW);
    // Quality 4 holds ease at 2.5, so 6 * 2.5 = 15.
    expect(third.intervalDays).toBe(15);
    expect(third.repetitions).toBe(3);
  });

  it('sets dueAt to exactly intervalDays after the review', () => {
    const result = schedule(initialState(), 4, NOW);
    expect(daysBetween(NOW, result.dueAt)).toBe(result.intervalDays);
  });

  it('grows monotonically across a long successful streak', () => {
    let state: SchedulingState = initialState();
    let previous = 0;

    for (let review = 0; review < 12; review += 1) {
      const result = schedule(state, 4, NOW);
      expect(result.intervalDays).toBeGreaterThan(previous);
      previous = result.intervalDays;
      state = result;
    }
  });
});

describe('sm2 — ease factor', () => {
  it('leaves ease unchanged at quality 4', () => {
    expect(schedule(initialState(), 4, NOW).easeFactor).toBe(DEFAULT_EASE_FACTOR);
  });

  it('raises ease at quality 5', () => {
    expect(schedule(initialState(), 5, NOW).easeFactor).toBeGreaterThan(DEFAULT_EASE_FACTOR);
  });

  it('lowers ease at quality 3', () => {
    expect(schedule(initialState(), 3, NOW).easeFactor).toBeLessThan(DEFAULT_EASE_FACTOR);
  });

  it('never falls below the 1.3 floor, however many failures', () => {
    let state: SchedulingState = initialState();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      state = schedule(state, 0, NOW);
    }
    expect(state.easeFactor).toBe(MIN_EASE_FACTOR);
    expect(state.easeFactor).toBeGreaterThanOrEqual(MIN_EASE_FACTOR);
  });

  it('matches the published SM-2 formula for each quality', () => {
    // EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
    const cases: [ReviewQuality, number][] = [
      [5, 2.6],
      [4, 2.5],
      [3, 2.36],
    ];

    for (const [quality, expected] of cases) {
      const result = schedule(initialState(), quality, NOW);
      expect(result.easeFactor).toBeCloseTo(expected, 4);
    }
  });
});

describe('sm2 — lapses', () => {
  it('resets the repetition chain on a failed review', () => {
    const mature: SchedulingState = {
      easeFactor: 2.5,
      intervalDays: 40,
      repetitions: 6,
      lapses: 0,
      state: 'REVIEW',
    };

    const result = schedule(mature, 1, NOW);
    expect(result.passed).toBe(false);
    expect(result.repetitions).toBe(0);
    expect(result.intervalDays).toBe(1);
    expect(result.lapses).toBe(1);
    expect(result.state).toBe('RELEARNING');
  });

  it.each([0, 1, 2] as ReviewQuality[])('treats quality %i as a lapse', (quality) => {
    expect(schedule(initialState(), quality, NOW).passed).toBe(false);
  });

  it.each([3, 4, 5] as ReviewQuality[])('treats quality %i as a pass', (quality) => {
    expect(schedule(initialState(), quality, NOW).passed).toBe(true);
  });

  it('accumulates lapses across repeated failures', () => {
    let state: SchedulingState = initialState();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      state = schedule(state, 0, NOW);
    }
    expect(state.lapses).toBe(4);
  });
});

describe('sm2 — degenerate cases', () => {
  it('always advances at least one day even at minimum ease', () => {
    // At ease 1.3 a 1-day interval would round to 1 and stall the card.
    const stalled: SchedulingState = {
      easeFactor: MIN_EASE_FACTOR,
      intervalDays: 1,
      repetitions: 5,
      lapses: 9,
      state: 'LEARNING',
    };

    const result = schedule(stalled, 3, NOW);
    expect(result.intervalDays).toBeGreaterThan(stalled.intervalDays);
  });

  it('never produces a due date in the past', () => {
    const states: SchedulingState[] = [
      initialState(),
      { easeFactor: 1.3, intervalDays: 0, repetitions: 0, lapses: 20, state: 'RELEARNING' },
      { easeFactor: 2.5, intervalDays: 365, repetitions: 12, lapses: 0, state: 'REVIEW' },
    ];

    for (const state of states) {
      for (const quality of [0, 1, 2, 3, 4, 5] as ReviewQuality[]) {
        expect(schedule(state, quality, NOW).dueAt.getTime()).toBeGreaterThan(NOW.getTime());
      }
    }
  });
});

describe('sm2 — maturity', () => {
  it('classifies intervals against the 21-day threshold', () => {
    expect(isMature(MATURE_INTERVAL_DAYS)).toBe(true);
    expect(isMature(MATURE_INTERVAL_DAYS - 1)).toBe(false);
    expect(isMature(0)).toBe(false);
  });

  it('promotes a card to REVIEW once its interval matures', () => {
    const almost: SchedulingState = {
      easeFactor: 2.5,
      intervalDays: 15,
      repetitions: 3,
      lapses: 0,
      state: 'LEARNING',
    };
    // 15 * 2.5 = 38, past the maturity threshold.
    expect(schedule(almost, 4, NOW).state).toBe('REVIEW');
  });
});

describe('sm2 — rating previews', () => {
  it('orders previewed intervals from again through easy', () => {
    const state: SchedulingState = {
      easeFactor: 2.5,
      intervalDays: 10,
      repetitions: 3,
      lapses: 0,
      state: 'LEARNING',
    };

    const preview = previewIntervals(state, NOW);
    expect(preview.again).toBeLessThan(preview.hard);
    expect(preview.hard).toBeLessThanOrEqual(preview.good);
    expect(preview.good).toBeLessThanOrEqual(preview.easy);
  });

  it('previews exactly what schedule() would apply', () => {
    const state = initialState();
    const preview = previewIntervals(state, NOW);

    for (const [rating, quality] of Object.entries(RATING_TO_QUALITY)) {
      const applied = schedule(state, quality, NOW);
      expect(preview[rating as keyof typeof preview]).toBe(applied.intervalDays);
    }
  });
});

describe('sm2 — addDays', () => {
  it('adds whole days without mutating the input', () => {
    const original = new Date(NOW);
    const result = addDays(NOW, 7);
    expect(daysBetween(NOW, result)).toBe(7);
    expect(NOW.getTime()).toBe(original.getTime());
  });
});
