import 'server-only';

/**
 * Lightweight in-process event bus for decoupling feature side-effects.
 *
 * Handlers run fire-and-forget: a failing handler never blocks the caller or
 * other handlers. This is intentional — gamification and notifications are
 * best-effort and must never degrade the primary user flow.
 */

export type AppEvent =
  | { type: 'assignment.completed'; userId: string; assignmentId: string; subjectId?: string | null }
  | { type: 'focus.session.ended'; userId: string; minutes: number }
  | { type: 'flashcard.reviewed'; userId: string; count: number }
  | { type: 'note.created'; userId: string }
  | { type: 'ai.chat.sent'; userId: string }
  | { type: 'quiz.completed'; userId: string }
  | { type: 'lms.sync.completed'; userId: string; connectionId: string; newItems: number }
  | { type: 'streak.updated'; userId: string; streak: number };

type Handler = (event: AppEvent) => void | Promise<void>;

const handlers: Map<AppEvent['type'], Handler[]> = new Map();

export function on(type: AppEvent['type'], handler: Handler): void {
  const list = handlers.get(type) ?? [];
  list.push(handler);
  handlers.set(type, list);
}

export function emit(event: AppEvent): void {
  const list = handlers.get(event.type);
  if (!list) return;
  for (const handler of list) {
    try {
      const result = handler(event);
      if (result && typeof result === 'object' && 'catch' in result) {
        (result as Promise<void>).catch(() => {});
      }
    } catch {
      // best-effort — never propagate
    }
  }
}

// ---------------------------------------------------------------------------
// Default handlers — wired once at module load
// ---------------------------------------------------------------------------

on('focus.session.ended', async (event) => {
  if (event.type !== 'focus.session.ended') return;
  try {
    const { awardXp, updateMissionProgress, updateChallengeProgress, updateMonthlyChallengeProgress } =
      await import('./gamification.service');
    await awardXp(event.userId, 25);
    await updateMissionProgress(event.userId, 'focus_1', 1);
    // Study time missions — minutes map to the study_30m daily mission
    await updateMissionProgress(event.userId, 'study_30m', event.minutes);
    // Weekly challenge: study 5 hours (target is 300 minutes)
    await updateChallengeProgress(event.userId, 'study_5h', event.minutes);
    // Monthly challenge: study 25 hours (target is 1500 minutes)
    await updateMonthlyChallengeProgress(event.userId, 'study_25h', event.minutes);
  } catch {
    // best-effort
  }
});

on('flashcard.reviewed', async (event) => {
  if (event.type !== 'flashcard.reviewed') return;
  try {
    const { awardXp, updateMissionProgress, updateChallengeProgress, updateMonthlyChallengeProgress } =
      await import('./gamification.service');
    await awardXp(event.userId, 5 * event.count);
    await updateMissionProgress(event.userId, 'review_10', event.count);
    await updateChallengeProgress(event.userId, 'review_50', event.count);
    await updateMonthlyChallengeProgress(event.userId, 'review_200', event.count);
  } catch {
    // best-effort
  }
});

on('note.created', async (event) => {
  if (event.type !== 'note.created') return;
  try {
    const { awardXp, updateMissionProgress, updateChallengeProgress, updateMonthlyChallengeProgress } =
      await import('./gamification.service');
    await awardXp(event.userId, 15);
    await updateMissionProgress(event.userId, 'note_1', 1);
    await updateChallengeProgress(event.userId, 'notes_3', 1);
    await updateMonthlyChallengeProgress(event.userId, 'notes_10', 1);
  } catch {
    // best-effort
  }
});

on('ai.chat.sent', async (event) => {
  if (event.type !== 'ai.chat.sent') return;
  try {
    const { updateMissionProgress } = await import('./gamification.service');
    await updateMissionProgress(event.userId, 'ai_chat_3', 1);
  } catch {
    // best-effort
  }
});

on('quiz.completed', async (event) => {
  if (event.type !== 'quiz.completed') return;
  try {
    const { awardXp, updateMissionProgress } = await import('./gamification.service');
    await awardXp(event.userId, 20);
    await updateMissionProgress(event.userId, 'quiz_1', 1);
  } catch {
    // best-effort
  }
});

on('streak.updated', async (event) => {
  if (event.type !== 'streak.updated') return;
  try {
    const { updateMissionProgress, updateChallengeProgress, updateMonthlyChallengeProgress } =
      await import('./gamification.service');
    await updateMissionProgress(event.userId, 'streak_login', 1);
    await updateChallengeProgress(event.userId, 'streak_7', 1);
    await updateMonthlyChallengeProgress(event.userId, 'streak_20', 1);
  } catch {
    // best-effort
  }
});

export const eventBus = { on, emit } as const;
