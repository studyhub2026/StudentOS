import { z } from 'zod';
import { geminiService } from './gemini.service.js';
import type { CardDifficulty } from '@prisma/client';

/**
 * Gemini-backed study content generation.
 *
 * Every function here returns typed, schema-validated data — never raw model
 * text — so callers can persist results without re-parsing. When
 * GEMINI_API_KEY is unset the underlying service throws a 503, which surfaces
 * to the client as "AI features unavailable" rather than a crash.
 */

// --- Flashcards -------------------------------------------------------------

const generatedCardSchema = z.object({
  front: z.string().trim().min(1).max(4000),
  back: z.string().trim().min(1).max(4000),
  hint: z.string().trim().max(1000).nullish(),
});

const generatedCardsSchema = z.object({
  cards: z.array(generatedCardSchema).min(1),
});

export interface GeneratedCard {
  front: string;
  back: string;
  hint: string | null;
  difficulty: CardDifficulty;
  generatedByAi: true;
}

/** Response schema handed to Gemini to constrain its JSON output. */
const CARD_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          front: { type: 'string' },
          back: { type: 'string' },
          hint: { type: 'string' },
        },
        required: ['front', 'back'],
      },
    },
  },
  required: ['cards'],
} as const;

const DIFFICULTY_GUIDANCE: Record<CardDifficulty, string> = {
  EASY: 'Focus on definitions, terminology and direct recall of single facts.',
  MEDIUM: 'Mix recall with relationships between concepts and short applications.',
  HARD: 'Emphasise multi-step reasoning, edge cases, comparisons and application to novel situations.',
};

export async function generateFlashcards(input: {
  source: string;
  count: number;
  difficulty: CardDifficulty;
}): Promise<{ cards: GeneratedCard[]; model: string; totalTokens: number }> {
  const systemInstruction = [
    'You write flashcards for a student revising the supplied material.',
    'Each card tests exactly one idea. Fronts are specific questions, never "What is this about?".',
    'Backs are complete but concise — one to three sentences.',
    'Use only information present in the source material. Never invent facts.',
    'Do not number the cards or reference "the text" or "the passage".',
    DIFFICULTY_GUIDANCE[input.difficulty],
  ].join(' ');

  const result = await geminiService.generateJson({
    systemInstruction,
    messages: [
      {
        role: 'user',
        content: `Create exactly ${input.count} flashcards from this material:\n\n${input.source}`,
      },
    ],
    responseSchema: CARD_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => generatedCardsSchema.parse(value),
  });

  return {
    // The model occasionally returns a few extra; trim rather than reject.
    cards: result.data.cards.slice(0, input.count).map((card) => ({
      front: card.front,
      back: card.back,
      hint: card.hint ?? null,
      difficulty: input.difficulty,
      generatedByAi: true as const,
    })),
    model: result.model,
    totalTokens: result.totalTokens,
  };
}

// --- Note summarisation -----------------------------------------------------

const summarySchema = z.object({
  summary: z.string().trim().min(1),
  keyPoints: z.array(z.string().trim().min(1)).max(12),
});

const SUMMARY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    keyPoints: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'keyPoints'],
} as const;

export async function summariseNote(content: string): Promise<{
  summary: string;
  keyPoints: string[];
  model: string;
  totalTokens: number;
}> {
  const result = await geminiService.generateJson({
    systemInstruction:
      'You summarise study notes for revision. Be concise and factual. ' +
      'The summary is a single paragraph. Key points are short, self-contained bullets. ' +
      'Use only what appears in the notes.',
    messages: [{ role: 'user', content: `Summarise these notes:\n\n${content}` }],
    responseSchema: SUMMARY_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => summarySchema.parse(value),
  });

  return {
    summary: result.data.summary,
    keyPoints: result.data.keyPoints,
    model: result.model,
    totalTokens: result.totalTokens,
  };
}

// --- Quiz -------------------------------------------------------------------

const quizSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().trim().min(1),
        options: z.array(z.string().trim().min(1)).length(4),
        correctIndex: z.number().int().min(0).max(3),
        explanation: z.string().trim().min(1),
      }),
    )
    .min(1),
});

const QUIZ_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correctIndex: { type: 'integer' },
          explanation: { type: 'string' },
        },
        required: ['question', 'options', 'correctIndex', 'explanation'],
      },
    },
  },
  required: ['questions'],
} as const;

export type QuizQuestion = z.infer<typeof quizSchema>['questions'][number];

export async function generateQuiz(input: {
  source: string;
  count: number;
}): Promise<{ questions: QuizQuestion[]; model: string; totalTokens: number }> {
  const result = await geminiService.generateJson({
    systemInstruction:
      'You write multiple-choice revision questions. Every question has exactly four options, ' +
      'one unambiguously correct. Distractors must be plausible and drawn from the same material — ' +
      'never obviously wrong filler. correctIndex is the zero-based index of the right option. ' +
      'Explain briefly why the answer is correct.',
    messages: [
      {
        role: 'user',
        content: `Write exactly ${input.count} multiple-choice questions from:\n\n${input.source}`,
      },
    ],
    responseSchema: QUIZ_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => quizSchema.parse(value),
  });

  return {
    questions: result.data.questions.slice(0, input.count),
    model: result.model,
    totalTokens: result.totalTokens,
  };
}

export const aiStudyService = {
  generateFlashcards,
  summariseNote,
  generateQuiz,
  isConfigured: geminiService.isConfigured,
} as const;
