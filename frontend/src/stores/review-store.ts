'use client';

import { create } from 'zustand';
import type { ReviewCard, ReviewRating } from '@/types/api';

/**
 * Drives one review session.
 *
 * The queue is loaded once and consumed locally, so grading a card never
 * refetches and never reshuffles what the student is part-way through. Failed
 * cards are requeued at the end of the session, matching how SM-2 relearning
 * behaves in practice.
 */
interface ReviewState {
  queue: ReviewCard[];
  index: number;
  revealed: boolean;
  /** When the current card was first shown, for response timing. */
  shownAt: number;

  answered: number;
  correct: number;
  /** Cards graded "again", replayed before the session ends. */
  requeued: ReviewCard[];
  finished: boolean;

  start: (cards: ReviewCard[]) => void;
  reveal: () => void;
  grade: (rating: ReviewRating) => void;
  reset: () => void;

  currentCard: () => ReviewCard | null;
  remaining: () => number;
  accuracy: () => number;
  elapsedMs: () => number;
}

const INITIAL = {
  queue: [] as ReviewCard[],
  index: 0,
  revealed: false,
  shownAt: 0,
  answered: 0,
  correct: 0,
  requeued: [] as ReviewCard[],
  finished: false,
};

export const useReviewStore = create<ReviewState>((set, get) => ({
  ...INITIAL,

  start: (cards) =>
    set({
      ...INITIAL,
      queue: cards,
      shownAt: Date.now(),
      finished: cards.length === 0,
    }),

  reveal: () => set({ revealed: true }),

  grade: (rating) => {
    const state = get();
    const card = state.queue[state.index];
    if (!card) return;

    const passed = rating !== 'again';
    const requeued = passed ? state.requeued : [...state.requeued, card];
    const nextIndex = state.index + 1;

    // Once the main queue is exhausted, replay anything graded "again".
    if (nextIndex >= state.queue.length) {
      if (requeued.length > 0) {
        set({
          queue: requeued,
          requeued: [],
          index: 0,
          revealed: false,
          shownAt: Date.now(),
          answered: state.answered + 1,
          correct: state.correct + (passed ? 1 : 0),
        });
        return;
      }

      set({
        answered: state.answered + 1,
        correct: state.correct + (passed ? 1 : 0),
        revealed: false,
        finished: true,
      });
      return;
    }

    set({
      index: nextIndex,
      revealed: false,
      shownAt: Date.now(),
      requeued,
      answered: state.answered + 1,
      correct: state.correct + (passed ? 1 : 0),
    });
  },

  reset: () => set(INITIAL),

  currentCard: () => {
    const { queue, index, finished } = get();
    return finished ? null : (queue[index] ?? null);
  },

  remaining: () => {
    const { queue, index, requeued } = get();
    return Math.max(0, queue.length - index) + requeued.length;
  },

  accuracy: () => {
    const { answered, correct } = get();
    return answered === 0 ? 0 : Math.round((correct / answered) * 100);
  },

  elapsedMs: () => {
    const { shownAt } = get();
    return shownAt === 0 ? 0 : Date.now() - shownAt;
  },
}));
