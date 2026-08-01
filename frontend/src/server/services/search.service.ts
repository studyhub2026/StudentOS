import 'server-only';
import { prisma } from '@/server/db';

export type SearchCategory =
  | 'assignment'
  | 'note'
  | 'subject'
  | 'flashcard_deck'
  | 'flashcard'
  | 'schedule'
  | 'ai_conversation'
  | 'tutor_conversation'
  | 'group'
  | 'group_message'
  | 'uploaded_file'
  | 'goal'
  | 'notification';

export interface SearchResult {
  id: string;
  category: SearchCategory;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  url: string;
  icon: string | null;
  color: string | null;
  updatedAt: string;
}

export interface SearchOptions {
  query: string;
  userId: string;
  categories?: SearchCategory[];
  limit?: number;
  offset?: number;
}

export function highlight(text: string, query: string, maxLen = 120): string {
  if (!text) return '';
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, maxLen);
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 80);
  let slice = text.slice(start, end);
  if (start > 0) slice = '...' + slice;
  if (end < text.length) slice += '...';
  return slice;
}

export async function universalSearch(opts: SearchOptions): Promise<{
  results: SearchResult[];
  total: number;
}> {
  const { query, userId, limit = 20, offset = 0 } = opts;
  const cats = opts.categories;
  const q = query.trim();
  if (!q) return { results: [], total: 0 };

  const results: SearchResult[] = [];

  const include = (cat: SearchCategory) => !cats || cats.length === 0 || cats.includes(cat);

  const promises: Promise<void>[] = [];

  if (include('assignment')) {
    promises.push(
      prisma.assignment
        .findMany({
          where: {
            userId,
            deletedAt: null,
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { labels: { hasSome: [q] } },
            ],
          },
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            priority: true,
            updatedAt: true,
            subject: { select: { name: true, color: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        })
        .then((rows) => {
          for (const r of rows) {
            results.push({
              id: r.id,
              category: 'assignment',
              title: r.title,
              subtitle: r.subject?.name ?? r.status,
              excerpt: r.description ? highlight(r.description, q) : null,
              url: '/assignments',
              icon: null,
              color: r.subject?.color ?? null,
              updatedAt: r.updatedAt.toISOString(),
            });
          }
        }),
    );
  }

  if (include('note')) {
    promises.push(
      prisma.note
        .findMany({
          where: {
            userId,
            deletedAt: null,
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { content: { contains: q, mode: 'insensitive' } },
              { tags: { hasSome: [q] } },
            ],
          },
          select: {
            id: true,
            title: true,
            content: true,
            excerpt: true,
            tags: true,
            updatedAt: true,
            subject: { select: { name: true, color: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        })
        .then((rows) => {
          for (const r of rows) {
            results.push({
              id: r.id,
              category: 'note',
              title: r.title,
              subtitle: r.subject?.name ?? (r.tags.length ? r.tags.slice(0, 3).join(', ') : null),
              excerpt: r.excerpt ?? (r.content ? highlight(r.content, q) : null),
              url: `/notes`,
              icon: null,
              color: r.subject?.color ?? null,
              updatedAt: r.updatedAt.toISOString(),
            });
          }
        }),
    );
  }

  if (include('subject')) {
    promises.push(
      prisma.subject
        .findMany({
          where: {
            userId,
            archived: false,
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { code: { contains: q, mode: 'insensitive' } },
              { teacherName: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: { id: true, name: true, code: true, color: true, icon: true, teacherName: true, updatedAt: true },
          orderBy: { name: 'asc' },
          take: limit,
        })
        .then((rows) => {
          for (const r of rows) {
            results.push({
              id: r.id,
              category: 'subject',
              title: r.name,
              subtitle: [r.code, r.teacherName].filter(Boolean).join(' · ') || null,
              excerpt: null,
              url: '/assignments',
              icon: r.icon,
              color: r.color,
              updatedAt: r.updatedAt.toISOString(),
            });
          }
        }),
    );
  }

  if (include('flashcard_deck')) {
    promises.push(
      prisma.flashcardDeck
        .findMany({
          where: {
            userId,
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            name: true,
            description: true,
            color: true,
            updatedAt: true,
            subject: { select: { name: true, color: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        })
        .then((rows) => {
          for (const r of rows) {
            results.push({
              id: r.id,
              category: 'flashcard_deck',
              title: r.name,
              subtitle: r.subject?.name ?? null,
              excerpt: r.description ? highlight(r.description, q) : null,
              url: `/flashcards/${r.id}`,
              icon: null,
              color: r.color ?? r.subject?.color ?? null,
              updatedAt: r.updatedAt.toISOString(),
            });
          }
        }),
    );
  }

  if (include('flashcard')) {
    promises.push(
      prisma.flashcard
        .findMany({
          where: {
            deck: { userId },
            OR: [
              { front: { contains: q, mode: 'insensitive' } },
              { back: { contains: q, mode: 'insensitive' } },
              { tags: { hasSome: [q] } },
            ],
          },
          select: {
            id: true,
            front: true,
            back: true,
            deckId: true,
            updatedAt: true,
            deck: { select: { name: true, color: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        })
        .then((rows) => {
          for (const r of rows) {
            results.push({
              id: r.id,
              category: 'flashcard',
              title: r.front.slice(0, 100),
              subtitle: r.deck.name,
              excerpt: r.back ? highlight(r.back, q) : null,
              url: `/flashcards/${r.deckId}`,
              icon: null,
              color: r.deck.color ?? null,
              updatedAt: r.updatedAt.toISOString(),
            });
          }
        }),
    );
  }

  if (include('schedule')) {
    promises.push(
      prisma.scheduleBlock
        .findMany({
          where: {
            userId,
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { notes: { contains: q, mode: 'insensitive' } },
              { location: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            title: true,
            type: true,
            startAt: true,
            location: true,
            notes: true,
            updatedAt: true,
            subject: { select: { name: true, color: true } },
          },
          orderBy: { startAt: 'desc' },
          take: limit,
        })
        .then((rows) => {
          for (const r of rows) {
            results.push({
              id: r.id,
              category: 'schedule',
              title: r.title,
              subtitle: r.subject?.name ?? r.type,
              excerpt: r.location ?? (r.notes ? highlight(r.notes, q) : null),
              url: '/schedule',
              icon: null,
              color: r.subject?.color ?? null,
              updatedAt: r.updatedAt.toISOString(),
            });
          }
        }),
    );
  }

  if (include('ai_conversation')) {
    promises.push(
      prisma.aiConversation
        .findMany({
          where: {
            userId,
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { messages: { some: { content: { contains: q, mode: 'insensitive' } } } },
            ],
          },
          select: {
            id: true,
            title: true,
            feature: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        })
        .then((rows) => {
          for (const r of rows) {
            results.push({
              id: r.id,
              category: 'ai_conversation',
              title: r.title ?? 'AI Chat',
              subtitle: r.feature,
              excerpt: null,
              url: '/ai',
              icon: null,
              color: null,
              updatedAt: r.updatedAt.toISOString(),
            });
          }
        }),
    );
  }

  if (include('tutor_conversation')) {
    promises.push(
      prisma.tutorConversation
        .findMany({
          where: {
            userId,
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { messages: { some: { content: { contains: q, mode: 'insensitive' } } } },
            ],
          },
          select: {
            id: true,
            title: true,
            updatedAt: true,
            tutor: { select: { id: true, subject: true, emoji: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        })
        .then((rows) => {
          for (const r of rows) {
            results.push({
              id: r.id,
              category: 'tutor_conversation',
              title: r.title ?? `${r.tutor.subject} Chat`,
              subtitle: `${r.tutor.emoji} ${r.tutor.subject}`,
              excerpt: null,
              url: `/tutors/${r.tutor.id}`,
              icon: r.tutor.emoji,
              color: null,
              updatedAt: r.updatedAt.toISOString(),
            });
          }
        }),
    );
  }

  if (include('group')) {
    promises.push(
      prisma.studyGroup
        .findMany({
          where: {
            members: { some: { userId } },
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            name: true,
            description: true,
            avatarUrl: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        })
        .then((rows) => {
          for (const r of rows) {
            results.push({
              id: r.id,
              category: 'group',
              title: r.name,
              subtitle: 'Study Group',
              excerpt: r.description ? highlight(r.description, q) : null,
              url: `/groups/${r.id}`,
              icon: null,
              color: null,
              updatedAt: r.updatedAt.toISOString(),
            });
          }
        }),
    );
  }

  if (include('group_message')) {
    promises.push(
      prisma.message
        .findMany({
          where: {
            authorId: userId,
            deletedAt: null,
            content: { contains: q, mode: 'insensitive' },
          },
          select: {
            id: true,
            content: true,
            createdAt: true,
            channel: {
              select: {
                name: true,
                group: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
        })
        .then((rows) => {
          for (const r of rows) {
            results.push({
              id: r.id,
              category: 'group_message',
              title: highlight(r.content, q, 80),
              subtitle: r.channel.group ? `${r.channel.group.name} #${r.channel.name}` : `#${r.channel.name}`,
              excerpt: null,
              url: r.channel.group ? `/groups/${r.channel.group.id}` : '/groups',
              icon: null,
              color: null,
              updatedAt: r.createdAt.toISOString(),
            });
          }
        }),
    );
  }

  if (include('uploaded_file')) {
    promises.push(
      prisma.uploadedFile
        .findMany({
          where: {
            userId,
            OR: [
              { filename: { contains: q, mode: 'insensitive' } },
              { extractedText: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            filename: true,
            mimeType: true,
            extractedText: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
        })
        .then((rows) => {
          for (const r of rows) {
            results.push({
              id: r.id,
              category: 'uploaded_file',
              title: r.filename,
              subtitle: r.mimeType,
              excerpt: r.extractedText ? highlight(r.extractedText, q) : null,
              url: '/ai',
              icon: null,
              color: null,
              updatedAt: r.createdAt.toISOString(),
            });
          }
        }),
    );
  }

  if (include('goal')) {
    promises.push(
      prisma.goal
        .findMany({
          where: {
            userId,
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            updatedAt: true,
            subject: { select: { name: true, color: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        })
        .then((rows) => {
          for (const r of rows) {
            results.push({
              id: r.id,
              category: 'goal',
              title: r.title,
              subtitle: r.subject?.name ?? r.status,
              excerpt: r.description ? highlight(r.description, q) : null,
              url: '/analytics',
              icon: null,
              color: r.subject?.color ?? null,
              updatedAt: r.updatedAt.toISOString(),
            });
          }
        }),
    );
  }

  if (include('notification')) {
    promises.push(
      prisma.notification
        .findMany({
          where: {
            userId,
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { body: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            title: true,
            body: true,
            type: true,
            link: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
        })
        .then((rows) => {
          for (const r of rows) {
            results.push({
              id: r.id,
              category: 'notification',
              title: r.title,
              subtitle: r.type,
              excerpt: r.body ? highlight(r.body, q) : null,
              url: r.link ?? '/dashboard',
              icon: null,
              color: null,
              updatedAt: r.createdAt.toISOString(),
            });
          }
        }),
    );
  }

  await Promise.all(promises);

  results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const total = results.length;
  const paged = results.slice(offset, offset + limit);

  return { results: paged, total };
}
