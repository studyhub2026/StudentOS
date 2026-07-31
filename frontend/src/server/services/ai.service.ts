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
import { aiFileService } from '@/server/services/ai-file.service';
import { aiMemoryService } from '@/server/services/ai-memory.service';

/**
 * Conversational AI and the structured generators that back the AI suite.
 *
 * Conversations are persisted so a student can return to a thread; every
 * structured feature validates the model's JSON before it reaches a caller.
 */

const conversationInclude = {
  messages: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.AiConversationInclude;

export type ConversationWithMessages = Prisma.AiConversationGetPayload<{
  include: typeof conversationInclude;
}>;

/** Turns kept in the model's context window. Older turns stay in the database. */
const CONTEXT_TURNS = 20;

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
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { aiTone: true, aiModel: true },
  });

  let conversation = input.conversationId
    ? await getConversation(userId, input.conversationId)
    : await createConversation(userId, {
        feature: input.feature,
        title: deriveTitle(input.content),
      });

  const userMessage = await prisma.aiMessage.create({
    data: { conversationId: conversation.id, role: AiRole.USER, content: input.content },
  });

  // Link any just-uploaded files to the message that first referenced them.
  if (input.fileIds && input.fileIds.length > 0) {
    await aiFileService.attachFilesToMessage(input.fileIds, userMessage.id);
  }

  // Re-read so the outgoing context includes the turn just written.
  conversation = await getConversation(userId, conversation.id);

  const featureKey = conversation.feature as AiFeatureKey;
  const baseInstruction = withTone(
    SYSTEM_PROMPTS[featureKey] ?? SYSTEM_PROMPTS.CHAT,
    settings?.aiTone ?? 'encouraging',
  );

  // Every ready file on the conversation is included each turn, so questions
  // about a document keep working after it has scrolled out of view.
  const files = await prisma.uploadedFile.findMany({
    where: { conversationId: conversation.id, userId, status: 'READY' },
    orderBy: { createdAt: 'asc' },
  });
  const fileContext = await aiFileService.buildFileContext(files);

  // Long-term memory keeps the assistant personal across separate conversations.
  const memoryContext = await aiMemoryService.getMemoryContext(userId);

  const systemInstruction = [baseInstruction, memoryContext, fileContext.textPreamble]
    .filter(Boolean)
    .join('\n\n');

  const result = await geminiService.generateText({
    messages: toGeminiMessages(conversation.messages),
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
    signal?: AbortSignal;
  },
): AsyncGenerator<{ type: 'meta' | 'delta' | 'done'; data: unknown }, void, undefined> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { aiTone: true },
  });

  let conversation = input.conversationId
    ? await getConversation(userId, input.conversationId)
    : await createConversation(userId, {
        feature: input.feature,
        title: deriveTitle(input.content),
      });

  await prisma.aiMessage.create({
    data: { conversationId: conversation.id, role: AiRole.USER, content: input.content },
  });

  conversation = await getConversation(userId, conversation.id);

  yield { type: 'meta', data: { conversationId: conversation.id } };

  const featureKey = conversation.feature as AiFeatureKey;
  const stream = geminiService.streamText({
    messages: toGeminiMessages(conversation.messages),
    systemInstruction: withTone(
      SYSTEM_PROMPTS[featureKey] ?? SYSTEM_PROMPTS.CHAT,
      settings?.aiTone ?? 'encouraging',
    ),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  let accumulated = '';
  let final: Awaited<ReturnType<typeof geminiService.generateText>> | null = null;

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
                  promptTokens: final.promptTokens,
                  completionTokens: final.completionTokens,
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
    data: { conversationId: conversation.id, totalTokens: final?.totalTokens ?? 0 },
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
