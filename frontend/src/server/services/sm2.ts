import 'server-only';
/**
 * SM-2 spaced repetition scheduler (SuperMemo 2, Wozniak & Drozdzewski 1998).
 *
 * Deliberately pure — no database, no clock beyond an injectable `now`. All
 * scheduling decisions live here so they can be tested exhaustively and reused
 * by both the review endpoint and any future bulk rescheduling job.
 */

export type CardState = 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';

/** SM-2 recall quality, 0 (blackout) to 5 (perfect). */
export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

export interface SchedulingState {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  state: CardState;
}

export interface SchedulingResult extends SchedulingState {
  dueAt: Date;
  /** True when the answer counted as a successful recall (quality >= 3). */
  passed: boolean;
}

/**
 * Below 3 the item was not recalled and the repetition chain resets. This
 * threshold is defined by SM-2 itself, not a tuning knob.
 */
export const PASS_THRESHOLD = 3;

/**
 * Ease may not drop below 1.3; lower values collapse intervals so aggressively
 * that a card would be shown forever.
 */
export const MIN_EASE_FACTOR = 1.3;

export const DEFAULT_EASE_FACTOR = 2.5;

/** Interval, in days, at which a card is considered committed to memory. */
export const MATURE_INTERVAL_DAYS = 21;

const FIRST_INTERVAL_DAYS = 1;
const SECOND_INTERVAL_DAYS = 6;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function initialState(): SchedulingState {
  return {
    easeFactor: DEFAULT_EASE_FACTOR,
    intervalDays: 0,
    repetitions: 0,
    lapses: 0,
    state: 'NEW',
  };
}

/**
 * The SM-2 ease adjustment:
 *   EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
 *
 * Quality 4 leaves ease unchanged; 5 raises it, 3 and below lower it.
 */
function nextEaseFactor(current: number, quality: ReviewQuality): number {
  const delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  return Math.max(MIN_EASE_FACTOR, roundTo(current + delta, 4));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Applies one review to a card's scheduling state.
 *
 * A failed review resets the repetition chain and schedules the card for the
 * same day rather than pushing it out — the point of a lapse is to see the
 * card again soon.
 */
export function schedule(
  current: SchedulingState,
  quality: ReviewQuality,
  now: Date = new Date(),
): SchedulingResult {
  const passed = quality >= PASS_THRESHOLD;
  const easeFactor = nextEaseFactor(current.easeFactor, quality);

  if (!passed) {
    return {
      easeFactor,
      intervalDays: FIRST_INTERVAL_DAYS,
      repetitions: 0,
      lapses: current.lapses + 1,
      state: 'RELEARNING',
      dueAt: addDays(now, FIRST_INTERVAL_DAYS),
      passed: false,
    };
  }

  const repetitions = current.repetitions + 1;

  let intervalDays: number;
  if (repetitions === 1) {
    intervalDays = FIRST_INTERVAL_DAYS;
  } else if (repetitions === 2) {
    intervalDays = SECOND_INTERVAL_DAYS;
  } else {
    // From the third successful repetition onward the interval compounds by
    // the card's ease. Always advance by at least a day so a low ease cannot
    // stall the card on a repeating same-day schedule.
    intervalDays = Math.max(
      current.intervalDays + 1,
      Math.round(current.intervalDays * easeFactor),
    );
  }

  return {
    easeFactor,
    intervalDays,
    repetitions,
    lapses: current.lapses,
    state: intervalDays >= MATURE_INTERVAL_DAYS ? 'REVIEW' : 'LEARNING',
    dueAt: addDays(now, intervalDays),
    passed: true,
  };
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function isMature(intervalDays: number): boolean {
  return intervalDays >= MATURE_INTERVAL_DAYS;
}

/**
 * Maps the four review buttons the UI presents onto SM-2 qualities. Keeping
 * this mapping here means the client never sends raw algorithm values.
 */
export const RATING_TO_QUALITY = {
  again: 0,
  hard: 3,
  good: 4,
  easy: 5,
} as const satisfies Record<string, ReviewQuality>;

export type ReviewRating = keyof typeof RATING_TO_QUALITY;

/**
 * Previews the interval each rating would produce, so the review UI can label
 * its buttons ("Good — 6d") without duplicating the algorithm.
 */
export function previewIntervals(
  current: SchedulingState,
  now: Date = new Date(),
): Record<ReviewRating, number> {
  return {
    again: schedule(current, RATING_TO_QUALITY.again, now).intervalDays,
    hard: schedule(current, RATING_TO_QUALITY.hard, now).intervalDays,
    good: schedule(current, RATING_TO_QUALITY.good, now).intervalDays,
    easy: schedule(current, RATING_TO_QUALITY.easy, now).intervalDays,
  };
}
