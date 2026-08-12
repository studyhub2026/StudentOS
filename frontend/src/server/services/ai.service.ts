import 'server-only';
import { AiFeature, AiRole, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { NotFoundError } from '@/server/lib/errors';
import {
  EXAM_SCHEMA,
  EXPLANATION_SCHEMA,
  LEARNING_PATH_SCHEMA,
  REVISION_SCHEMA,
  SYSTEM_PROMPTS,
  clampSource,
  withTone,
  type AiFeatureKey,
} from '@/server/services/ai-prompts';
import { geminiService, type GeminiMessage } from '@/server/services/gemini.service';
import { resolveProvider } from '@/server/ai/router';
import type { AiMessage } from '@/server/ai/provider';
import { aiFileService } from '@/server/services/ai-file.service';
import { aiMemoryService } from '@/server/services/ai-memory.service';
import { aiContextService } from '@/server/services/ai-context.service';
import { emit } from '@/server/services/event-bus';

/**
 * Conversational AI and the structured generators that back the AI suite.
 *
 * Conversations are persisted so a student can return to a thread; every
 * structured feature validates the model's JSON before it reaches a caller.
 */

/**
 * Full-history include: every message in the thread, oldest first. Used by
 * detail-view endpoints where the client wants the whole transcript.
 */
const conversationInclude = {
  messages: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.AiConversationInclude;

export type ConversationWithMessages = Prisma.AiConversationGetPayload<{
  include: typeof conversationInclude;
}>;

/** Turns kept in the model's context window. Older turns stay in the database. */
const CONTEXT_TURNS = 20;

/**
 * Hot-path include: only the tail of the thread that the model actually needs.
 * `take: CONTEXT_TURNS + 2` covers the 20-turn window plus a small buffer so we
 * still have full context after the current user turn is appended in memory.
 * Ordered desc + reversed in the caller so we hit the index on (conversationId,
 * createdAt DESC) and never scan discarded rows.
 */
const chatIncludeTail = {
  messages: { orderBy: { createdAt: 'desc' as const }, take: CONTEXT_TURNS + 2 },
} satisfies Prisma.AiConversationInclude;

type ConversationWithTail = Prisma.AiConversationGetPayload<{
  include: typeof chatIncludeTail;
}>;

async function loadConversationTail(
  userId: string,
  id: string,
): Promise<ConversationWithTail> {
  const conversation = await prisma.aiConversation.findFirst({
    where: { id, userId, deletedAt: null },
    include: chatIncludeTail,
  });
  if (!conversation) throw new NotFoundError('Conversation');
  // Restore chronological order so toGeminiMessages walks user→model→user…
  conversation.messages.reverse();
  return conversation;
}

// --- Conversations ----------------------------------------------------------

export async function listConversations(
  userId: string,
  feature?: AiFeature,
): Promise<
  { id: string; title: string; feature: AiFeature; pinned: boolean; updatedAt: Date; messageCount: number }[]
> {
  const conversations = await prisma.aiConversation.findMany({
    where: { userId, deletedAt: null, ...(feature ? { feature } : {}) },
    orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    take: 100,
    select: {
      id: true,
      title: true,
      feature: true,
      pinned: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  return conversations.map(({ _count, ...conversation }) => ({
    ...conversation,
    messageCount: _count.messages,
  }));
}

export async function getConversation(
  userId: string,
  id: string,
): Promise<ConversationWithMessages> {
  const conversation = await prisma.aiConversation.findFirst({
    where: { id, userId, deletedAt: null },
    include: conversationInclude,
  });
  if (!conversation) throw new NotFoundError('Conversation');
  return conversation;
}

export async function createConversation(
  userId: string,
  input: { feature: AiFeature; title?: string; context?: Record<string, unknown> },
): Promise<ConversationWithMessages> {
  return prisma.aiConversation.create({
    data: {
      userId,
      feature: input.feature,
      title: input.title ?? 'New conversation',
      context: (input.context as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
    },
    include: conversationInclude,
  });
}

export async function deleteConversation(userId: string, id: string): Promise<void> {
  const result = await prisma.aiConversation.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new NotFoundError('Conversation');
}

export async function renameConversation(
  userId: string,
  id: string,
  title: string,
): Promise<void> {
  const result = await prisma.aiConversation.updateMany({
    where: { id, userId, deletedAt: null },
    data: { title },
  });
  if (result.count === 0) throw new NotFoundError('Conversation');
}

/** Derives a thread title from the opening question. */
function deriveTitle(prompt: string): string {
  const firstLine = prompt.split('\n')[0]?.trim() ?? 'New conversation';
  return firstLine.length <= 60 ? firstLine : `${firstLine.slice(0, 57).trimEnd()}…`;
}

/**
 * Provider-neutral message shape used by streaming (goes through the
 * resolver + AiProvider). `toGeminiMessages` below keeps the non-stream
 * paths that still call geminiService directly unchanged.
 */
function toProviderMessages(
  messages: { role: AiRole; content: string }[],
): AiMessage[] {
  return messages
    .filter((message) => message.role !== AiRole.SYSTEM)
    .slice(-CONTEXT_TURNS)
    .map((message) => ({
      role: message.role === AiRole.USER ? ('user' as const) : ('assistant' as const),
      content: message.content,
    }));
}

function toGeminiMessages(
  messages: { role: AiRole; content: string }[],
): GeminiMessage[] {
  return messages
    // SYSTEM turns are carried via systemInstruction, not the transcript.
    .filter((message) => message.role !== AiRole.SYSTEM)
    .slice(-CONTEXT_TURNS)
    .map((message) => ({
      role: message.role === AiRole.USER ? ('user' as const) : ('model' as const),
      content: message.content,
    }));
}

export interface ChatResult {
  conversationId: string;
  message: { id: string; role: AiRole; content: string; createdAt: Date };
  model: string;
  totalTokens: number;
  latencyMs: number;
}

/**
 * Appends a user turn, generates a reply, and persists both.
 *
 * The user's message is written before generation so a failed or cancelled
 * request still leaves their question in the thread rather than losing it.
 */
export async function sendMessage(
  userId: string,
  input: {
    conversationId?: string;
    feature: AiFeature;
    content: string;
    tier?: 'flash' | 'pro';
    /** Files (already uploaded to this conversation) to link to this turn. */
    fileIds?: string[];
  },
): Promise<ChatResult> {
  // Resolve the target conversation first so subsequent DB calls that need its
  // id can proceed in parallel. Uses the tail include so we never read the
  // whole thread just to keep the last 20 turns.
  const conversation = input.conversationId
    ? await loadConversationTail(userId, input.conversationId)
    : await createConversation(userId, {
        feature: input.feature,
        title: deriveTitle(input.content),
      });

  // Persist the user turn, and — in parallel — read the three pieces of
  // context we'll need to build the prompt. All four operations are
  // independent so we can wait for them together instead of serially.
  const [userMessage, settings, files, memoryContext, academicContext] = await Promise.all([
    prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: AiRole.USER, content: input.content },
    }),
    prisma.userSettings.findUnique({
      where: { userId },
      select: { aiTone: true, aiModel: true },
    }),
    prisma.uploadedFile.findMany({
      where: { conversationId: conversation.id, userId, status: 'READY' },
      orderBy: { createdAt: 'asc' },
    }),
    aiMemoryService.getMemoryContext(userId),
    aiContextService.retrieveAcademicContext(userId, input.content),
  ]);

  // Link any just-uploaded files to the message that first referenced them.
  // Fire-and-forget: the link is metadata, not required for the model call.
  if (input.fileIds && input.fileIds.length > 0) {
    void aiFileService.attachFilesToMessage(input.fileIds, userMessage.id);
  }

  const fileContext = await aiFileService.buildFileContext(files);

  // Synthesise the fresh transcript in memory rather than re-reading the DB.
  // The tail we already loaded is up-to-date except for the turn we just wrote.
  const transcript = [
    ...conversation.messages,
    { role: AiRole.USER, content: input.content },
  ];

  const featureKey = conversation.feature as AiFeatureKey;
  const baseInstruction = withTone(
    SYSTEM_PROMPTS[featureKey] ?? SYSTEM_PROMPTS.CHAT,
    settings?.aiTone ?? 'encouraging',
  );

  const systemInstruction = [baseInstruction, memoryContext, academicContext, fileContext.textPreamble]
    .filter(Boolean)
    .join('\n\n');

  const result = await geminiService.generateText({
    messages: toGeminiMessages(transcript),
    systemInstruction,
    ...(input.tier ? { tier: input.tier } : {}),
    ...(fileContext.inlineParts.length > 0
      ? {
          attachments: fileContext.inlineParts.map((part) => ({
            mimeType: part.mimeType,
            dataBase64: part.dataBase64,
          })),
        }
      : {}),
  });

  const [saved] = await prisma.$transaction([
    prisma.aiMessage.create({
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
    prisma.aiConversation.update({
      where: { id: conversation.id },
      data: { model: result.model, updatedAt: new Date() },
    }),
  ]);

  emit({ type: 'ai.chat.sent', userId });

  return {
    conversationId: conversation.id,
    message: {
      id: saved.id,
      role: saved.role,
      content: saved.content,
      createdAt: saved.createdAt,
    },
    model: result.model,
    totalTokens: result.totalTokens,
    latencyMs: result.latencyMs,
  };
}

/**
 * Streaming variant. Yields text deltas and persists the completed reply once
 * the stream closes; a client disconnect therefore still records what was
 * generated rather than losing the turn.
 */
export async function* streamMessage(
  userId: string,
  input: {
    conversationId?: string;
    feature: AiFeature;
    content: string;
    tier?: 'flash' | 'pro';
    fileIds?: string[];
    signal?: AbortSignal;
  },
): AsyncGenerator<{ type: 'meta' | 'delta' | 'done'; data: unknown }, void, undefined> {
  const conversation = input.conversationId
    ? await loadConversationTail(userId, input.conversationId)
    : await createConversation(userId, {
        feature: input.feature,
        title: deriveTitle(input.content),
      });

  // Emit the meta frame BEFORE any further DB work so the browser flushes its
  // fetch reader immediately and the UI can render an in-flight bubble.
  yield { type: 'meta', data: { conversationId: conversation.id } };

  // Persist the user turn + gather context in parallel. Same shape as
  // sendMessage so streaming replies get memory + files + tone that
  // non-streaming replies have always had.
  const [userMessage, settings, files, memoryContext, academicContext] = await Promise.all([
    prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: AiRole.USER, content: input.content },
    }),
    prisma.userSettings.findUnique({
      where: { userId },
      select: { aiTone: true },
    }),
    prisma.uploadedFile.findMany({
      where: { conversationId: conversation.id, userId, status: 'READY' },
      orderBy: { createdAt: 'asc' },
    }),
    aiMemoryService.getMemoryContext(userId),
    aiContextService.retrieveAcademicContext(userId, input.content),
  ]);

  if (input.fileIds && input.fileIds.length > 0) {
    void aiFileService.attachFilesToMessage(input.fileIds, userMessage.id);
  }

  const fileContext = await aiFileService.buildFileContext(files);

  // Fresh transcript = tail we loaded + the turn we just wrote. Skips the
  // second getConversation round-trip that used to happen here.
  const transcript = [
    ...conversation.messages,
    { role: AiRole.USER, content: input.content },
  ];

  const featureKey = conversation.feature as AiFeatureKey;
  const baseInstruction = withTone(
    SYSTEM_PROMPTS[featureKey] ?? SYSTEM_PROMPTS.CHAT,
    settings?.aiTone ?? 'encouraging',
  );
  const systemInstruction = [baseInstruction, memoryContext, academicContext, fileContext.textPreamble]
    .filter(Boolean)
    .join('\n\n');

  // Route through the resolver — chat picks up AI_CHAT_PROVIDER if set,
  // otherwise falls back to Gemini so existing deployments keep identical
  // behavior. The provider adapter maps our AiMessage shape to whatever the
  // underlying SDK/API expects, so no branching per provider here.
  const provider = resolveProvider({ task: 'chat' });
  const stream = provider.streamText({
    messages: toProviderMessages(transcript),
    systemInstruction,
    ...(input.tier ? { tier: input.tier } : {}),
    ...(fileContext.inlineParts.length > 0
      ? {
          attachments: fileContext.inlineParts.map((part) => ({
            mimeType: part.mimeType,
            dataBase64: part.dataBase64,
          })),
        }
      : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  let accumulated = '';
  let final: Awaited<ReturnType<typeof provider.generateText>> | null = null;

  try {
    let next = await stream.next();
    while (!next.done) {
      accumulated += next.value;
      yield { type: 'delta', data: next.value };
      next = await stream.next();
    }
    final = next.value;
  } finally {
    // Persist whatever arrived, even on an aborted stream.
    if (accumulated.trim()) {
      await prisma.$transaction([
        prisma.aiMessage.create({
          data: {
            conversationId: conversation.id,
            role: AiRole.MODEL,
            content: accumulated,
            ...(final
              ? {
                  promptTokens: final.usage.promptTokens,
                  completionTokens: final.usage.completionTokens,
                  latencyMs: final.latencyMs,
                  finishReason: final.finishReason,
                }
              : {}),
          },
        }),
        prisma.aiConversation.update({
          where: { id: conversation.id },
          data: { updatedAt: new Date() },
        }),
      ]);
    }
  }

  yield {
    type: 'done',
    data: {
      conversationId: conversation.id,
      totalTokens: final?.usage.totalTokens ?? 0,
      provider: final?.provider,
      model: final?.model,
    },
  };
}

// --- Structured generators --------------------------------------------------

// Exported so the rejection of malformed model output can be tested directly.
export const examSchema = z.object({
  title: z.string().trim().min(1),
  durationMinutes: z.number().int().positive(),
  totalMarks: z.number().int().positive(),
  questions: z
    .array(
      z.object({
        number: z.number().int().positive(),
        question: z.string().trim().min(1),
        marks: z.number().int().positive(),
        markScheme: z.string().trim().min(1),
        topic: z.string().trim().nullish(),
      }),
    )
    .min(1),
});

export type GeneratedExam = z.infer<typeof examSchema>;

export async function generateExam(input: {
  source: string;
  questionCount: number;
  durationMinutes: number;
  level: string;
  subject: string;
}): Promise<GeneratedExam & { model: string; totalTokens: number }> {
  const result = await geminiService.generateJson({
    systemInstruction: SYSTEM_PROMPTS.EXAM_SIMULATOR,
    messages: [
      {
        role: 'user',
        content: [
          `Write a ${input.durationMinutes}-minute ${input.level} ${input.subject} exam`,
          `with exactly ${input.questionCount} questions, based on this material:`,
          '',
          clampSource(input.source),
        ].join('\n'),
      },
    ],
    responseSchema: EXAM_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => examSchema.parse(value),
  });

  return { ...result.data, model: result.model, totalTokens: result.totalTokens };
}

export const explanationSchema = z.object({
  definition: z.string().trim().min(1),
  explanation: z.string().trim().min(1),
  example: z.string().trim().min(1),
  commonMistake: z.string().trim().min(1),
  relatedConcepts: z.array(z.string().trim().min(1)).default([]),
});

export type ConceptExplanation = z.infer<typeof explanationSchema>;

export async function explainConcept(input: {
  concept: string;
  level: string;
  context?: string;
}): Promise<ConceptExplanation & { model: string; totalTokens: number }> {
  const result = await geminiService.generateJson({
    systemInstruction: SYSTEM_PROMPTS.CONCEPT_EXPLAINER,
    messages: [
      {
        role: 'user',
        content: [
          `Explain "${input.concept}" at ${input.level} level.`,
          input.context ? `\nRelevant material:\n${clampSource(input.context, 8000)}` : '',
        ].join(''),
      },
    ],
    responseSchema: EXPLANATION_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => explanationSchema.parse(value),
  });

  return { ...result.data, model: result.model, totalTokens: result.totalTokens };
}

export const learningPathSchema = z.object({
  goal: z.string().trim().min(1),
  totalHours: z.number().int().positive(),
  steps: z
    .array(
      z.object({
        order: z.number().int().positive(),
        title: z.string().trim().min(1),
        description: z.string().trim().min(1),
        estimatedHours: z.number().int().positive(),
        masteryCheck: z.string().trim().min(1),
      }),
    )
    .min(1),
});

export type LearningPath = z.infer<typeof learningPathSchema>;

export async function generateLearningPath(input: {
  goal: string;
  currentLevel: string;
  hoursPerWeek: number;
}): Promise<LearningPath & { model: string; totalTokens: number }> {
  const result = await geminiService.generateJson({
    systemInstruction: SYSTEM_PROMPTS.LEARNING_PATH,
    messages: [
      {
        role: 'user',
        content: `Design a learning path towards: ${input.goal}. The student is currently at ${input.currentLevel} level and can study about ${input.hoursPerWeek} hours per week. Order the steps so each builds on the last.`,
      },
    ],
    responseSchema: LEARNING_PATH_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => learningPathSchema.parse(value),
  });

  // Renumber defensively: the model occasionally returns steps out of order.
  const steps = [...result.data.steps]
    .sort((a, b) => a.order - b.order)
    .map((step, index) => ({ ...step, order: index + 1 }));

  return {
    ...result.data,
    steps,
    model: result.model,
    totalTokens: result.totalTokens,
  };
}

export const revisionSchema = z.object({
  topic: z.string().trim().min(1),
  keyFacts: z.array(z.string().trim().min(1)).default([]),
  formulae: z.array(z.string().trim().min(1)).default([]),
  definitions: z
    .array(
      z.object({ term: z.string().trim().min(1), meaning: z.string().trim().min(1) }),
    )
    .default([]),
  examTips: z.array(z.string().trim().min(1)).default([]),
});

export type RevisionSheet = z.infer<typeof revisionSchema>;

export async function generateRevisionSheet(input: {
  source: string;
  topic: string;
}): Promise<RevisionSheet & { model: string; totalTokens: number }> {
  const result = await geminiService.generateJson({
    systemInstruction: SYSTEM_PROMPTS.REVISION_GENERATOR,
    messages: [
      {
        role: 'user',
        content: `Produce a condensed revision sheet on "${input.topic}" from this material:\n\n${clampSource(input.source)}`,
      },
    ],
    responseSchema: REVISION_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => revisionSchema.parse(value),
  });

  return { ...result.data, model: result.model, totalTokens: result.totalTokens };
}

/**
 * Motivation coach. Free text rather than structured — a schema here would
 * make the reply feel mechanical, which defeats the purpose.
 */
export async function coach(input: {
  situation: string;
  stats?: { streak: number; studyMinutesWeek: number; overdue: number };
}): Promise<{ message: string; model: string; totalTokens: number }> {
  const context = input.stats
    ? `\n\nTheir recent activity: ${input.stats.streak}-day streak, ${input.stats.studyMinutesWeek} minutes studied this week, ${input.stats.overdue} overdue assignments.`
    : '';

  const result = await geminiService.generateFromPrompt(
    `A student says: "${input.situation}"${context}\n\nRespond as their study coach in 3–5 sentences.`,
    { systemInstruction: SYSTEM_PROMPTS.MOTIVATION_COACH, temperature: 0.8, maxOutputTokens: 600 },
  );

  return { message: result.text, model: result.model, totalTokens: result.totalTokens };
}

export const aiService = {
  listConversations,
  getConversation,
  createConversation,
  deleteConversation,
  renameConversation,
  sendMessage,
  streamMessage,
  generateExam,
  explainConcept,
  generateLearningPath,
  generateRevisionSheet,
  coach,
  isConfigured: geminiService.isConfigured,
} as const;
