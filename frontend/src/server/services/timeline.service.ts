import 'server-only';
import { prisma } from '@/server/db';

/**
 * A time-ordered feed of things the student has done: assignments completed,
 * study sessions, focus blocks, notes written, achievements unlocked, quiz
 * runs. Every event carries the same shape so the client can render them in
 * a single stream without knowing the source table.
 */

export type TimelineEventKind =
  | 'assignment_created'
  | 'assignment_completed'
  | 'study_session'
  | 'focus_session'
  | 'schedule_block'
  | 'achievement'
  | 'note_created'
  | 'ai_conversation'
  | 'tutor_conversation';

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  at: string;
  title: string;
  subtitle: string | null;
  color: string | null;
  icon: string | null;
  url: string | null;
  minutes?: number;
}

interface Options {
  /** Include events at or after this time. Defaults to 60 days ago. */
  since?: Date;
  /** Overall row limit across all categories. */
  limit?: number;
}

const DEFAULT_LOOKBACK_DAYS = 60;
const DEFAULT_LIMIT = 200;

export async function getTimeline(userId: string, opts: Options = {}): Promise<TimelineEvent[]> {
  const since = opts.since ?? new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const perCategory = Math.min(limit, 80);

  const [
    assignmentsCreated,
    assignmentsCompleted,
    studySessions,
    scheduleBlocks,
    achievements,
    notes,
    aiConversations,
    tutorConversations,
  ] = await Promise.all([
    prisma.assignment.findMany({
      where: { userId, deletedAt: null, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: perCategory,
      select: {
        id: true,
        title: true,
        createdAt: true,
        subject: { select: { name: true, color: true } },
      },
    }),
    prisma.assignment.findMany({
      where: { userId, deletedAt: null, completedAt: { gte: since, not: null } },
      orderBy: { completedAt: 'desc' },
      take: perCategory,
      select: {
        id: true,
        title: true,
        completedAt: true,
        subject: { select: { name: true, color: true } },
      },
    }),
    prisma.studySession.findMany({
      where: { userId, startedAt: { gte: since } },
      orderBy: { startedAt: 'desc' },
      take: perCategory,
      select: {
        id: true,
        type: true,
        startedAt: true,
        endedAt: true,
        durationSeconds: true,
        subject: { select: { name: true, color: true } },
      },
    }),
    prisma.scheduleBlock.findMany({
      where: { userId, startAt: { gte: since } },
      orderBy: { startAt: 'desc' },
      take: perCategory,
      select: {
        id: true,
        title: true,
        type: true,
        startAt: true,
        endAt: true,
        subject: { select: { name: true, color: true } },
      },
    }),
    prisma.userAchievement.findMany({
      where: { userId, unlockedAt: { gte: since, not: null } },
      orderBy: { unlockedAt: 'desc' },
      take: perCategory,
      select: {
        id: true,
        unlockedAt: true,
        achievement: { select: { name: true, description: true, icon: true, tier: true } },
      },
    }),
    prisma.note.findMany({
      where: { userId, deletedAt: null, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: perCategory,
      select: {
        id: true,
        title: true,
        createdAt: true,
        subject: { select: { name: true, color: true } },
      },
    }),
    prisma.aiConversation.findMany({
      where: { userId, deletedAt: null, updatedAt: { gte: since } },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: { id: true, title: true, feature: true, updatedAt: true },
    }),
    prisma.tutorConversation.findMany({
      where: { userId, deletedAt: null, updatedAt: { gte: since } },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        tutor: { select: { id: true, subject: true, emoji: true } },
      },
    }),
  ]);

  const events: TimelineEvent[] = [];

  for (const a of assignmentsCreated) {
    events.push({
      id: `ac-${a.id}`,
      kind: 'assignment_created',
      at: a.createdAt.toISOString(),
      title: `New assignment: ${a.title}`,
      subtitle: a.subject?.name ?? null,
      color: a.subject?.color ?? null,
      icon: null,
      url: '/assignments',
    });
  }
  for (const a of assignmentsCompleted) {
    events.push({
      id: `ad-${a.id}`,
      kind: 'assignment_completed',
      at: (a.completedAt as Date).toISOString(),
      title: `Finished: ${a.title}`,
      subtitle: a.subject?.name ?? null,
      color: a.subject?.color ?? null,
      icon: null,
      url: '/assignments',
    });
  }
  for (const s of studySessions) {
    const minutes = Math.round(s.durationSeconds / 60);
    events.push({
      id: `ss-${s.id}`,
      kind: s.type === 'POMODORO' ? 'focus_session' : 'study_session',
      at: s.startedAt.toISOString(),
      title: `${s.type === 'POMODORO' ? 'Focus session' : 'Study session'}${minutes ? ` — ${minutes}m` : ''}`,
      subtitle: s.subject?.name ?? null,
      color: s.subject?.color ?? null,
      icon: null,
      url: '/analytics',
      minutes,
    });
  }
  for (const b of scheduleBlocks) {
    const minutes = Math.round((b.endAt.getTime() - b.startAt.getTime()) / 60000);
    events.push({
      id: `sb-${b.id}`,
      kind: 'schedule_block',
      at: b.startAt.toISOString(),
      title: b.title,
      subtitle: b.subject?.name ?? b.type,
      color: b.subject?.color ?? null,
      icon: null,
      url: '/schedule',
      minutes,
    });
  }
  for (const ua of achievements) {
    events.push({
      id: `ua-${ua.id}`,
      kind: 'achievement',
      at: (ua.unlockedAt as Date).toISOString(),
      title: `Unlocked: ${ua.achievement.name}`,
      subtitle: ua.achievement.description,
      color: null,
      icon: ua.achievement.icon,
      url: '/achievements',
    });
  }
  for (const n of notes) {
    events.push({
      id: `n-${n.id}`,
      kind: 'note_created',
      at: n.createdAt.toISOString(),
      title: `Note: ${n.title}`,
      subtitle: n.subject?.name ?? null,
      color: n.subject?.color ?? null,
      icon: null,
      url: '/notes',
    });
  }
  for (const c of aiConversations) {
    events.push({
      id: `ai-${c.id}`,
      kind: 'ai_conversation',
      at: c.updatedAt.toISOString(),
      title: c.title ?? 'AI chat',
      subtitle: c.feature,
      color: null,
      icon: null,
      url: '/ai',
    });
  }
  for (const c of tutorConversations) {
    events.push({
      id: `tc-${c.id}`,
      kind: 'tutor_conversation',
      at: c.updatedAt.toISOString(),
      title: c.title ?? `${c.tutor.subject} chat`,
      subtitle: c.tutor.subject,
      color: null,
      icon: c.tutor.emoji,
      url: `/tutors/${c.tutor.id}`,
    });
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return events.slice(0, limit);
}
