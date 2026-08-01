import 'server-only';
import { AiRole, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { logger } from '@/server/lib/logger';
import { NotFoundError } from '@/server/lib/errors';
import { geminiService } from '@/server/services/gemini.service';
import { getTutorOrThrow } from '@/server/services/tutor.service';
import {
  TUTOR_FLASHCARD_SCHEMA,
  TUTOR_INSIGHT_SCHEMA,
  TUTOR_LEARNING_SCHEMA,
  TUTOR_QUIZ_SCHEMA,
} from '@/server/services/tutor-prompts';

/**
 * The "AI insights" layer: structured generation (quizzes, flashcards),
 * quiz-performance accounting, the cached insight snapshot, and the background
 * pass that turns each conversation turn into durable progress. All of it is
 * scoped to a single tutor, so a subject's learning state stays its own.
 */

const MAX_TOPICS = 12;

/** Case-insensitive union with a cap, newest-first, trimmed. Exported for tests. */
export function mergeTopics(existing: string[], incoming: string[], remove: string[] = []): string[] {
  const removeSet = new Set(remove.map((t) => t.toLowerCase().trim()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const topic of [...incoming, ...existing]) {
    const norm = topic.toLowerCase().trim();
    if (!norm || removeSet.has(norm) || seen.has(norm)) continue;
    seen.add(norm);
    out.push(topic.trim());
    if (out.length >= MAX_TOPICS) break;
  }
  return out;
}

// --- Quiz -------------------------------------------------------------------

const quizSchema = z.object({
  title: z.string().trim().min(1),
  topic: z.string().trim().min(1),
  questions: z
    .array(
      z.object({
        question: z.string().trim().min(1),
        options: z.array(z.string().trim().min(1)).min(2).max(6),
        correctIndex: z.number().int().min(0),
        explanation: z.string().trim().min(1),
        topic: z.string().trim().nullish(),
      }),
    )
    .min(1)
    // Drop any question whose correct index is out of range for its options.
    .transform((questions) => questions.filter((q) => q.correctIndex < q.options.length))
    .refine((questions) => questions.length > 0, 'no valid questions'),
});

export type TutorQuiz = z.infer<typeof quizSchema>;

async function recentTopicHints(tutorId: string): Promise<string> {
  const messages = await prisma.tutorMessage.findMany({
    where: { conversation: { tutorId }, role: AiRole.USER },
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: { content: true },
  });
  return messages.map((m) => m.content).join('\n').slice(0, 2000);
}

export async function generateQuiz(
  userId: string,
  tutorId: string,
  input: { topic?: string; count: number; conversationId?: string },
): Promise<TutorQuiz & { messageId: string | null }> {
  const tutor = await getTutorOrThrow(userId, tutorId);

  const focus = input.topic
    ? `on the topic "${input.topic}"`
    : tutor.progress.weakTopics.length
      ? `focusing on topics the student finds hard: ${tutor.progress.weakTopics.join(', ')}`
      : `covering core ${tutor.subject} topics`;

  const hints = input.topic ? '' : `\n\nRecent things the student asked about:\n${await recentTopicHints(tutorId)}`;

  const result = await geminiService.generateJson({
    systemInstruction:
      `You are a ${tutor.subject} tutor writing a multiple-choice quiz. Each question has one ` +
      `unambiguously correct option and plausible distractors. Match the ${tutor.difficulty.toLowerCase()} ` +
      `difficulty level. Tag each question with the sub-topic it tests.`,
    messages: [
      {
        role: 'user',
        content: `Write a ${input.count}-question ${tutor.subject} quiz ${focus}.${hints}`,
      },
    ],
    responseSchema: TUTOR_QUIZ_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => quizSchema.parse(value),
  });

  let messageId: string | null = null;
  if (input.conversationId) {
    const conversation = await prisma.tutorConversation.findFirst({
      where: { id: input.conversationId, tutorId, userId, deletedAt: null },
      select: { id: true },
    });
    if (conversation) {
      const saved = await prisma.tutorMessage.create({
        data: {
          conversationId: conversation.id,
          role: AiRole.MODEL,
          content: `Here's a ${result.data.questions.length}-question quiz on ${result.data.topic}.`,
          data: { kind: 'quiz', quiz: result.data } as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      messageId = saved.id;
      await prisma.tutorConversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });
    }
  }

  return { ...result.data, messageId };
}

export async function submitQuiz(
  userId: string,
  tutorId: string,
  input: { total: number; correct: number; topic?: string; missedTopics?: string[] },
): Promise<{ masteryScore: number; weakTopics: string[]; quizzesTaken: number }> {
  const tutor = await getTutorOrThrow(userId, tutorId);
  const p = tutor.progress;

  const quizQuestions = p.quizQuestions + input.total;
  const quizCorrect = p.quizCorrect + input.correct;
  // Mastery drifts towards the running quiz accuracy rather than jumping to it.
  const accuracy = quizQuestions > 0 ? (quizCorrect / quizQuestions) * 100 : 0;
  const masteryScore = Math.round(p.masteryScore * 0.6 + accuracy * 0.4);

  const weakTopics = mergeTopics(p.weakTopics, input.missedTopics ?? []);

  const updated = await prisma.tutorProgress.update({
    where: { tutorId },
    data: {
      quizzesTaken: { increment: 1 },
      quizQuestions,
      quizCorrect,
      masteryScore,
      weakTopics,
    },
    select: { masteryScore: true, weakTopics: true, quizzesTaken: true },
  });

  return updated;
}

// --- Flashcards -------------------------------------------------------------

const flashcardSchema = z.object({
  topic: z.string().trim().min(1),
  cards: z
    .array(
      z.object({
        front: z.string().trim().min(1),
        back: z.string().trim().min(1),
        hint: z.string().trim().nullish(),
      }),
    )
    .min(1),
});

export type TutorFlashcards = z.infer<typeof flashcardSchema>;

export async function generateFlashcards(
  userId: string,
  tutorId: string,
  input: { topic?: string; count: number; conversationId?: string },
): Promise<TutorFlashcards & { messageId: string | null }> {
  const tutor = await getTutorOrThrow(userId, tutorId);
  const focus = input.topic ?? (tutor.progress.weakTopics[0] ?? `core ${tutor.subject}`);

  const result = await geminiService.generateJson({
    systemInstruction:
      `You are a ${tutor.subject} tutor writing revision flashcards. Each card tests exactly one idea; ` +
      `fronts are specific questions, backs are complete but concise.`,
    messages: [{ role: 'user', content: `Write ${input.count} ${tutor.subject} flashcards on "${focus}".` }],
    responseSchema: TUTOR_FLASHCARD_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => flashcardSchema.parse(value),
  });

  let messageId: string | null = null;
  if (input.conversationId) {
    const conversation = await prisma.tutorConversation.findFirst({
      where: { id: input.conversationId, tutorId, userId, deletedAt: null },
      select: { id: true },
    });
    if (conversation) {
      const saved = await prisma.tutorMessage.create({
        data: {
          conversationId: conversation.id,
          role: AiRole.MODEL,
          content: `Here are ${result.data.cards.length} flashcards on ${result.data.topic}.`,
          data: { kind: 'flashcards', flashcards: result.data } as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      messageId = saved.id;
      await prisma.tutorConversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });
    }
  }

  return { ...result.data, messageId };
}

// --- Insights ---------------------------------------------------------------

const insightSchema = z.object({
  todaysRecommendation: z.string().trim().min(1),
  suggestedRevision: z.string().trim().default(''),
  weakTopics: z.array(z.string().trim().min(1)).default([]),
  strongTopics: z.array(z.string().trim().min(1)).default([]),
  estimatedMastery: z.number().min(0).max(100),
  confidenceScore: z.number().min(0).max(100),
  summary: z.string().trim().min(1),
  recommendations: z
    .array(
      z.object({
        kind: z.string().trim().min(1).default('daily'),
        title: z.string().trim().min(1),
        body: z.string().trim().nullish(),
      }),
    )
    .default([]),
});

export type TutorInsightContent = z.infer<typeof insightSchema>;

export async function generateInsights(
  userId: string,
  tutorId: string,
): Promise<TutorInsightContent> {
  const tutor = await getTutorOrThrow(userId, tutorId);
  const p = tutor.progress;

  const messages = await prisma.tutorMessage.findMany({
    where: { conversation: { tutorId, deletedAt: null } },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { role: true, content: true },
  });
  const transcript = messages
    .reverse()
    .map((m) => `${m.role === AiRole.USER ? 'Student' : 'Tutor'}: ${m.content}`)
    .join('\n')
    .slice(0, 8000);

  const stats = [
    `Difficulty: ${tutor.difficulty}`,
    `Quizzes taken: ${p.quizzesTaken} (${p.quizCorrect}/${p.quizQuestions} correct)`,
    `Known weak topics: ${p.weakTopics.join(', ') || 'none yet'}`,
    `Known strong topics: ${p.strongTopics.join(', ') || 'none yet'}`,
    `Messages exchanged: ${p.messagesCount}`,
  ].join('\n');

  const result = await geminiService.generateJson({
    systemInstruction:
      `You are a ${tutor.subject} tutor analysing a student's progress. Be honest and specific. ` +
      `Base every judgement on the evidence given; if there is little history, say the estimates are ` +
      `provisional and keep mastery/confidence modest. Never invent performance the data doesn't show.`,
    messages: [
      {
        role: 'user',
        content:
          `Analyse this ${tutor.subject} student and produce insights.\n\n` +
          `Their tracked stats:\n${stats}\n\n` +
          `Recent conversation:\n${transcript || '(no conversation yet)'}`,
      },
    ],
    responseSchema: TUTOR_INSIGHT_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => insightSchema.parse(value),
    temperature: 0.4,
  });

  const content = result.data;

  // Persist the snapshot, fold topic/mastery estimates into progress, and
  // refresh the recommendation list — all atomically.
  await prisma.$transaction([
    prisma.tutorInsight.create({
      data: { tutorId, userId, content: content as unknown as Prisma.InputJsonValue },
    }),
    prisma.tutorProgress.update({
      where: { tutorId },
      data: {
        weakTopics: mergeTopics(p.weakTopics, content.weakTopics, content.strongTopics),
        strongTopics: mergeTopics(p.strongTopics, content.strongTopics, content.weakTopics),
        masteryScore: Math.round(content.estimatedMastery),
        confidenceScore: Math.round(content.confidenceScore),
      },
    }),
    prisma.tutorRecommendation.deleteMany({ where: { tutorId } }),
    ...(content.recommendations.length
      ? [
          prisma.tutorRecommendation.createMany({
            data: content.recommendations.slice(0, 6).map((r) => ({
              tutorId,
              userId,
              kind: r.kind,
              title: r.title,
              body: r.body ?? null,
            })),
          }),
        ]
      : []),
  ]);

  return content;
}

export async function getLatestInsight(userId: string, tutorId: string) {
  await getTutorOrThrow(userId, tutorId);
  const [insight, recommendations] = await Promise.all([
    prisma.tutorInsight.findFirst({
      where: { tutorId, userId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.tutorRecommendation.findMany({
      where: { tutorId, userId },
      orderBy: { createdAt: 'desc' },
      take: 6,
    }),
  ]);
  return { insight, recommendations };
}

export async function setRecommendationDone(
  userId: string,
  tutorId: string,
  recommendationId: string,
  done: boolean,
): Promise<void> {
  const result = await prisma.tutorRecommendation.updateMany({
    where: { id: recommendationId, tutorId, userId },
    data: { done },
  });
  if (result.count === 0) throw new NotFoundError('Recommendation');
}

// --- Background learning extraction -----------------------------------------

const learningSchema = z.object({
  weakTopics: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  strongTopics: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  mistakes: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  goals: z.string().trim().max(500).nullish(),
  explanationStyle: z.string().trim().max(300).nullish(),
});

/**
 * After a turn, extract durable learning signals and fold them into the tutor's
 * progress. Best-effort and background-only (called via the route's `after`),
 * so a failure never affects the reply the student already received.
 */
export async function extractLearning(
  userId: string,
  tutorId: string,
  userMessage: string,
  assistantReply: string,
): Promise<void> {
  try {
    const tutor = await prisma.tutor.findFirst({
      where: { id: tutorId, userId },
      include: { progress: true },
    });
    if (!tutor || !tutor.progress) return;

    const result = await geminiService.generateJson({
      systemInstruction:
        `You track a student's learning in ${tutor.subject}. From one exchange, extract ONLY durable ` +
        `signals: sub-topics they clearly struggle with (weakTopics), sub-topics they clearly grasp ` +
        `(strongTopics), specific mistakes they made (mistakes), any stated goal, and any stated ` +
        `preference for how they like things explained. Use short topic names. Return empty arrays if ` +
        `nothing is clear. Never invent struggles or mastery that the exchange doesn't show.`,
      messages: [
        {
          role: 'user',
          content: `Student:\n${userMessage}\n\nTutor:\n${assistantReply}\n\nExtract learning signals.`,
        },
      ],
      responseSchema: TUTOR_LEARNING_SCHEMA as unknown as Record<string, unknown>,
      parse: (value) => learningSchema.parse(value),
    });

    const data = result.data;
    const p = tutor.progress;

    const mistakes = (Array.isArray(p.mistakes) ? p.mistakes : []) as unknown[];
    const newMistakes = data.mistakes.map((m) => ({ mistake: m, at: new Date().toISOString() }));
    const mergedMistakes = [...newMistakes, ...mistakes].slice(0, 30);

    await prisma.tutorProgress.update({
      where: { tutorId },
      data: {
        weakTopics: mergeTopics(p.weakTopics, data.weakTopics, data.strongTopics),
        strongTopics: mergeTopics(p.strongTopics, data.strongTopics, data.weakTopics),
        mistakes: mergedMistakes as unknown as Prisma.InputJsonValue,
      },
    });

    // Style and goals live on the tutor itself; only fill when newly stated and
    // not already set, so we never clobber the student's explicit settings.
    if ((data.goals && !tutor.goals) || (data.explanationStyle && !tutor.explanationStyle)) {
      await prisma.tutor.update({
        where: { id: tutorId },
        data: {
          ...(data.goals && !tutor.goals ? { goals: data.goals } : {}),
          ...(data.explanationStyle && !tutor.explanationStyle
            ? { explanationStyle: data.explanationStyle }
            : {}),
        },
      });
    }
  } catch (error) {
    logger.warn({ err: error, userId, tutorId }, 'tutor learning extraction failed');
  }
}

export const tutorInsightService = {
  generateQuiz,
  submitQuiz,
  generateFlashcards,
  generateInsights,
  getLatestInsight,
  setRecommendationDone,
  extractLearning,
};
