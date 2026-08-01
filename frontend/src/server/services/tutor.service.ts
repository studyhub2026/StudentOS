import 'server-only';
import { AiRole, Prisma, TutorDifficulty } from '@prisma/client';
import { prisma } from '@/server/db';
import { NotFoundError } from '@/server/lib/errors';
import { geminiService, type GeminiMessage } from '@/server/services/gemini.service';
import { aiFileService } from '@/server/services/ai-file.service';
import { aiMemoryService } from '@/server/services/ai-memory.service';
import { SUBJECT_CATALOG, catalogEntry, slugifySubject } from '@/server/services/tutor-catalog';
import {
  buildTutorSystemPrompt,
  type TutorProgressSnapshot,
} from '@/server/services/tutor-prompts';

/**
 * Subject tutors: their lifecycle, isolated conversations and the chat itself.
 *
 * Every query is scoped by both `userId` and `tutorId`, so a student can only
 * ever reach their own tutors and — because a conversation belongs to exactly
 * one tutor — no context ever leaks from one subject to another.
 */

const CONTEXT_TURNS = 20;

const conversationInclude = {
  messages: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.TutorConversationInclude;

export type TutorConversationWithMessages = Prisma.TutorConversationGetPayload<{
  include: typeof conversationInclude;
}>;

// --- Tutor lifecycle --------------------------------------------------------

function progressSnapshot(
  progress: {
    weakTopics: string[];
    strongTopics: string[];
    masteryScore: number;
    confidenceScore: number;
    quizzesTaken: number;
    quizCorrect: number;
    quizQuestions: number;
  } | null,
): TutorProgressSnapshot | null {
  if (!progress) return null;
  return {
    weakTopics: progress.weakTopics,
    strongTopics: progress.strongTopics,
    masteryScore: progress.masteryScore,
    confidenceScore: progress.confidenceScore,
    quizzesTaken: progress.quizzesTaken,
    quizCorrect: progress.quizCorrect,
    quizQuestions: progress.quizQuestions,
  };
}

const tutorSelect = {
  id: true,
  subjectKey: true,
  subject: true,
  emoji: true,
  accent: true,
  difficulty: true,
  explanationStyle: true,
  goals: true,
  lastActiveAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TutorSelect;

export type TutorRecord = Prisma.TutorGetPayload<{ select: typeof tutorSelect }>;

type TutorWithMaybeProgress = Prisma.TutorGetPayload<{ include: { progress: true } }>;
/** A tutor guaranteed to carry its progress row. */
export type TutorWithProgress = Omit<TutorWithMaybeProgress, 'progress'> & {
  progress: NonNullable<TutorWithMaybeProgress['progress']>;
};

/**
 * Fetches a tutor by id, or throws. Ensures a progress row exists so callers
 * never have to null-check it.
 */
export async function getTutorOrThrow(userId: string, tutorId: string): Promise<TutorWithProgress> {
  const tutor = await prisma.tutor.findFirst({
    where: { id: tutorId, userId },
    include: { progress: true },
  });
  if (!tutor) throw new NotFoundError('Tutor');
  if (!tutor.progress) {
    const progress = await prisma.tutorProgress.create({ data: { tutorId: tutor.id } });
    return { ...tutor, progress };
  }
  return { ...tutor, progress: tutor.progress };
}

/** Creates (or returns the existing) tutor for a subject. */
export async function createTutor(
  userId: string,
  input: { subjectKey?: string; subject?: string; difficulty?: TutorDifficulty },
): Promise<TutorRecord> {
  const template = input.subjectKey ? catalogEntry(input.subjectKey) : undefined;

  const subjectKey = template
    ? template.key
    : slugifySubject(input.subject ?? input.subjectKey ?? 'subject');
  const subject = template?.subject ?? input.subject ?? 'Subject';
  const emoji = template?.emoji ?? '📘';
  const accent = template?.accent ?? '#6366f1';

  const tutor = await prisma.tutor.upsert({
    where: { userId_subjectKey: { userId, subjectKey } },
    create: {
      userId,
      subjectKey,
      subject,
      emoji,
      accent,
      ...(input.difficulty ? { difficulty: input.difficulty } : {}),
      progress: { create: {} },
    },
    update: input.difficulty ? { difficulty: input.difficulty } : {},
    select: tutorSelect,
  });

  return tutor;
}

export interface TutorCard extends TutorRecord {
  tagline: string;
  activated: boolean;
  masteryScore: number;
  confidenceScore: number;
  weakTopics: string[];
  quizzesTaken: number;
  conversationCount: number;
  lastConversation: { id: string; title: string; updatedAt: Date } | null;
}

/**
 * The dashboard view: every catalogue subject, merged with the student's own
 * tutor state where they have started one. Custom (non-catalogue) tutors are
 * appended so nothing the student created is hidden.
 */
export async function listTutors(userId: string): Promise<TutorCard[]> {
  const tutors = await prisma.tutor.findMany({
    where: { userId },
    include: {
      progress: true,
      conversations: {
        where: { deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { id: true, title: true, updatedAt: true },
      },
      _count: { select: { conversations: true } },
    },
  });

  const byKey = new Map(tutors.map((t) => [t.subjectKey, t]));

  const toCard = (
    base: TutorRecord & { tagline: string },
    row: (typeof tutors)[number] | undefined,
  ): TutorCard => ({
    ...base,
    activated: Boolean(row),
    masteryScore: row?.progress?.masteryScore ?? 0,
    confidenceScore: row?.progress?.confidenceScore ?? 0,
    weakTopics: row?.progress?.weakTopics ?? [],
    quizzesTaken: row?.progress?.quizzesTaken ?? 0,
    conversationCount: row?._count.conversations ?? 0,
    lastConversation: row?.conversations[0] ?? null,
  });

  // Catalogue subjects first, in catalogue order.
  const cards: TutorCard[] = SUBJECT_CATALOG.map((template) => {
    const row = byKey.get(template.key);
    const base: TutorRecord & { tagline: string } = row
      ? { ...row, tagline: template.tagline }
      : {
          id: '',
          subjectKey: template.key,
          subject: template.subject,
          emoji: template.emoji,
          accent: template.accent,
          difficulty: 'ADAPTIVE',
          explanationStyle: null,
          goals: null,
          lastActiveAt: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
          tagline: template.tagline,
        };
    return toCard(base, row);
  });

  // Any custom subjects the student added that aren't in the catalogue.
  for (const row of tutors) {
    if (catalogEntry(row.subjectKey)) continue;
    cards.push(
      toCard(
        { ...row, tagline: `Your ${row.subject} tutor.` },
        row,
      ),
    );
  }

  return cards;
}

export async function updateTutor(
  userId: string,
  tutorId: string,
  input: { difficulty?: TutorDifficulty; explanationStyle?: string | null; goals?: string | null },
): Promise<TutorRecord> {
  const result = await prisma.tutor.updateMany({
    where: { id: tutorId, userId },
    data: {
      ...(input.difficulty ? { difficulty: input.difficulty } : {}),
      ...(input.explanationStyle !== undefined ? { explanationStyle: input.explanationStyle } : {}),
      ...(input.goals !== undefined ? { goals: input.goals } : {}),
    },
  });
  if (result.count === 0) throw new NotFoundError('Tutor');
  return prisma.tutor.findUniqueOrThrow({ where: { id: tutorId }, select: tutorSelect });
}

// --- Conversations ----------------------------------------------------------

export async function listConversations(userId: string, tutorId: string) {
  await getTutorOrThrow(userId, tutorId);
  const conversations = await prisma.tutorConversation.findMany({
    where: { tutorId, userId, deletedAt: null },
    orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    take: 100,
    select: {
      id: true,
      title: true,
      pinned: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });
  return conversations.map(({ _count, ...c }) => ({ ...c, messageCount: _count.messages }));
}

export async function getConversation(
  userId: string,
  tutorId: string,
  id: string,
): Promise<TutorConversationWithMessages> {
  const conversation = await prisma.tutorConversation.findFirst({
    where: { id, tutorId, userId, deletedAt: null },
    include: conversationInclude,
  });
  if (!conversation) throw new NotFoundError('Conversation');
  return conversation;
}

export async function createConversation(
  userId: string,
  tutorId: string,
  input: { title?: string } = {},
): Promise<TutorConversationWithMessages> {
  await getTutorOrThrow(userId, tutorId);
  return prisma.tutorConversation.create({
    data: { userId, tutorId, title: input.title ?? 'New conversation' },
    include: conversationInclude,
  });
}

export async function updateConversation(
  userId: string,
  tutorId: string,
  id: string,
  input: { title?: string; pinned?: boolean },
): Promise<void> {
  const result = await prisma.tutorConversation.updateMany({
    where: { id, tutorId, userId, deletedAt: null },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
    },
  });
  if (result.count === 0) throw new NotFoundError('Conversation');
}

export async function deleteConversation(userId: string, tutorId: string, id: string): Promise<void> {
  const result = await prisma.tutorConversation.updateMany({
    where: { id, tutorId, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new NotFoundError('Conversation');
}

export async function updateMessage(
  userId: string,
  tutorId: string,
  messageId: string,
  input: { pinned?: boolean; content?: string },
): Promise<{ id: string; pinned: boolean; content: string; edited: boolean }> {
  // Ownership is enforced via the conversation → tutor → user chain.
  const message = await prisma.tutorMessage.findFirst({
    where: { id: messageId, conversation: { tutorId, userId, deletedAt: null } },
    select: { id: true },
  });
  if (!message) throw new NotFoundError('Message');

  const updated = await prisma.tutorMessage.update({
    where: { id: messageId },
    data: {
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      ...(input.content !== undefined ? { content: input.content, edited: true } : {}),
    },
    select: { id: true, pinned: true, content: true, edited: true },
  });
  return updated;
}

// --- Chat -------------------------------------------------------------------

function deriveTitle(prompt: string): string {
  const firstLine = prompt.split('\n')[0]?.trim() ?? 'New conversation';
  return firstLine.length <= 60 ? firstLine : `${firstLine.slice(0, 57).trimEnd()}…`;
}

function toGeminiMessages(messages: { role: AiRole; content: string }[]): GeminiMessage[] {
  return messages
    .filter((m) => m.role !== AiRole.SYSTEM)
    .slice(-CONTEXT_TURNS)
    .map((m) => ({
      role: m.role === AiRole.USER ? ('user' as const) : ('model' as const),
      content: m.content,
    }));
}

/** Builds the system instruction for a turn from all four context layers. */
async function buildContext(
  userId: string,
  tutor: Awaited<ReturnType<typeof getTutorOrThrow>>,
  conversationId: string,
  overrideDifficulty?: TutorDifficulty,
) {
  const files = await prisma.uploadedFile.findMany({
    where: { tutorConversationId: conversationId, userId, status: 'READY' },
    orderBy: { createdAt: 'asc' },
  });
  const fileContext = await aiFileService.buildFileContext(files);
  const memoryContext = await aiMemoryService.getMemoryContext(userId);

  const systemInstruction = buildTutorSystemPrompt({
    subject: tutor.subject,
    difficulty: overrideDifficulty ?? tutor.difficulty,
    explanationStyle: tutor.explanationStyle,
    goals: tutor.goals,
    progress: progressSnapshot(tutor.progress),
    memoryContext,
    fileContext: fileContext.textPreamble,
  });

  return { systemInstruction, inlineParts: fileContext.inlineParts };
}

export interface TutorChatResult {
  conversationId: string;
  message: { id: string; role: AiRole; content: string; createdAt: Date };
  model: string;
  totalTokens: number;
  latencyMs: number;
}

export async function sendMessage(
  userId: string,
  tutorId: string,
  input: {
    conversationId?: string;
    content: string;
    tier?: 'flash' | 'pro';
    fileIds?: string[];
    difficulty?: TutorDifficulty;
  },
): Promise<TutorChatResult> {
  const tutor = await getTutorOrThrow(userId, tutorId);

  const conversation = input.conversationId
    ? await getConversation(userId, tutorId, input.conversationId)
    : await createConversation(userId, tutorId, { title: deriveTitle(input.content) });

  // Files are attached to the conversation at upload time and included on every
  // turn by buildContext, so `fileIds` needs no extra linkage here.
  await prisma.tutorMessage.create({
    data: { conversationId: conversation.id, role: AiRole.USER, content: input.content },
  });

  const fresh = await getConversation(userId, tutorId, conversation.id);
  const { systemInstruction, inlineParts } = await buildContext(userId, tutor, conversation.id, input.difficulty);

  const result = await geminiService.generateText({
    messages: toGeminiMessages(fresh.messages),
    systemInstruction,
    ...(input.tier ? { tier: input.tier } : {}),
    ...(inlineParts.length > 0
      ? { attachments: inlineParts.map((p) => ({ mimeType: p.mimeType, dataBase64: p.dataBase64 })) }
      : {}),
  });

  const [saved] = await prisma.$transaction([
    prisma.tutorMessage.create({
      data: {
        conversationId: conversation.id,
        role: AiRole.MODEL,
        content: result.text,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        latencyMs: result.latencyMs,
        finishReason: result.finishReason,
      },
    }),
    prisma.tutorConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    }),
    prisma.tutor.update({ where: { id: tutorId }, data: { lastActiveAt: new Date() } }),
    prisma.tutorProgress.update({
      where: { tutorId },
      data: { messagesCount: { increment: 1 } },
    }),
  ]);

  return {
    conversationId: conversation.id,
    message: { id: saved.id, role: saved.role, content: saved.content, createdAt: saved.createdAt },
    model: result.model,
    totalTokens: result.totalTokens,
    latencyMs: result.latencyMs,
  };
}

export async function* streamMessage(
  userId: string,
  tutorId: string,
  input: {
    conversationId?: string;
    content: string;
    tier?: 'flash' | 'pro';
    difficulty?: TutorDifficulty;
    signal?: AbortSignal;
  },
): AsyncGenerator<{ type: 'meta' | 'delta' | 'done'; data: unknown }, void, undefined> {
  const tutor = await getTutorOrThrow(userId, tutorId);

  const conversation = input.conversationId
    ? await getConversation(userId, tutorId, input.conversationId)
    : await createConversation(userId, tutorId, { title: deriveTitle(input.content) });

  await prisma.tutorMessage.create({
    data: { conversationId: conversation.id, role: AiRole.USER, content: input.content },
  });

  const fresh = await getConversation(userId, tutorId, conversation.id);
  const { systemInstruction, inlineParts } = await buildContext(userId, tutor, conversation.id, input.difficulty);

  yield { type: 'meta', data: { conversationId: conversation.id } };

  const stream = geminiService.streamText({
    messages: toGeminiMessages(fresh.messages),
    systemInstruction,
    ...(input.tier ? { tier: input.tier } : {}),
    ...(inlineParts.length > 0
      ? { attachments: inlineParts.map((p) => ({ mimeType: p.mimeType, dataBase64: p.dataBase64 })) }
      : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  let accumulated = '';
  let final: Awaited<ReturnType<typeof geminiService.generateText>> | null = null;
  let messageId: string | null = null;

  try {
    let next = await stream.next();
    while (!next.done) {
      accumulated += next.value;
      yield { type: 'delta', data: next.value };
      next = await stream.next();
    }
    final = next.value;
  } finally {
    if (accumulated.trim()) {
      const saved = await prisma.tutorMessage.create({
        data: {
          conversationId: conversation.id,
          role: AiRole.MODEL,
          content: accumulated,
          ...(final
            ? {
                promptTokens: final.promptTokens,
                completionTokens: final.completionTokens,
                latencyMs: final.latencyMs,
                finishReason: final.finishReason,
              }
            : {}),
        },
      });
      messageId = saved.id;
      await prisma.$transaction([
        prisma.tutorConversation.update({
          where: { id: conversation.id },
          data: { updatedAt: new Date() },
        }),
        prisma.tutor.update({ where: { id: tutorId }, data: { lastActiveAt: new Date() } }),
        prisma.tutorProgress.update({
          where: { tutorId },
          data: { messagesCount: { increment: 1 } },
        }),
      ]);
    }
  }

  yield {
    type: 'done',
    data: {
      conversationId: conversation.id,
      messageId,
      reply: accumulated,
      totalTokens: final?.totalTokens ?? 0,
    },
  };
}

export const tutorService = {
  getTutorOrThrow,
  createTutor,
  listTutors,
  updateTutor,
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  updateMessage,
  sendMessage,
  streamMessage,
  isConfigured: geminiService.isConfigured,
};
