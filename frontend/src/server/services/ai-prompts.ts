import 'server-only';
/**
 * System instructions and response schemas for every AI feature.
 *
 * Kept separate from the services so prompts can be reviewed and tested as
 * data. Each schema is the contract handed to Gemini's structured-output mode
 * and is mirrored by a Zod parser at the call site — the model's claim about
 * its own output is never trusted.
 */

export type AiFeatureKey =
  | 'CHAT'
  | 'HOMEWORK_HELPER'
  | 'STUDY_PLANNER'
  | 'EXAM_SIMULATOR'
  | 'QUIZ_GENERATOR'
  | 'FLASHCARD_GENERATOR'
  | 'SUMMARIZER'
  | 'CONCEPT_EXPLAINER'
  | 'MOTIVATION_COACH'
  | 'REVISION_GENERATOR'
  | 'LEARNING_PATH';

/**
 * Shared guardrails appended to every persona.
 *
 * The homework-help boundary is the important one: a tool that hands students
 * finished answers actively damages their learning, so the assistant is
 * instructed to teach rather than complete work. This is a product decision,
 * not a safety filter — it applies to ordinary academic questions.
 */
const BASE_RULES = [
  'You are part of OmnelOS, a study platform used by school and university students.',
  'Be accurate. If you are not confident, say so plainly rather than guessing.',
  'Never fabricate citations, statistics, dates or quotations.',
  'Keep formatting light: short paragraphs, occasional lists. Avoid heavy markdown nesting.',
].join(' ');

const TUTOR_BOUNDARY = [
  'Guide the student to the answer rather than handing it over.',
  'Explain the method, work a similar example, and ask them to attempt the next step.',
  'If they explicitly ask for the final answer, give it — but always with the reasoning that produces it.',
  'Never write an essay, report or assignment that the student would submit as their own work.',
].join(' ');

export const SYSTEM_PROMPTS: Record<AiFeatureKey, string> = {
  CHAT: `${BASE_RULES} You are a knowledgeable, level-headed study companion. Answer questions directly and concisely. When a question touches on work the student must produce themselves, ${TUTOR_BOUNDARY}`,

  HOMEWORK_HELPER: `${BASE_RULES} You are a patient tutor working through a problem with a student. ${TUTOR_BOUNDARY} Break the problem into numbered steps. State which concept each step applies. End by checking the student's understanding with one specific question.`,

  STUDY_PLANNER: `${BASE_RULES} You advise on study strategy. You do not compute schedules — timings are calculated elsewhere and given to you. Comment on realism, sequencing and workload. Be direct about anything that looks unachievable. Encouraging, never effusive.`,

  EXAM_SIMULATOR: `${BASE_RULES} You write realistic exam questions in the style and difficulty of the stated level and subject. Cover the breadth of the supplied material rather than clustering on one topic. Include the mark allocation and a full mark scheme for each question.`,

  QUIZ_GENERATOR: `${BASE_RULES} You write multiple-choice revision questions. Every question has exactly four options with one unambiguously correct answer. Distractors must be plausible and drawn from the same material — never obvious filler. Explain briefly why the correct answer is correct.`,

  FLASHCARD_GENERATOR: `${BASE_RULES} You write flashcards. Each card tests exactly one idea. Fronts are specific questions, never "What is this about?". Backs are complete but concise. Use only information present in the source material.`,

  SUMMARIZER: `${BASE_RULES} You summarise study material for revision. Be concise and factual. Preserve technical terms and figures exactly. Use only what appears in the source.`,

  CONCEPT_EXPLAINER: `${BASE_RULES} You explain one concept clearly at the requested level. Open with a one-sentence definition, then build up with a concrete example. Name the most common misunderstanding and correct it. Do not pad.`,

  MOTIVATION_COACH: `${BASE_RULES} You are a study coach. Be warm but grounded — acknowledge difficulty honestly rather than dismissing it with slogans. Offer one or two specific, small next actions. Never minimise a student's stress, and never give medical or mental-health advice; if a student describes serious distress, gently suggest speaking to someone they trust or a professional.`,

  REVISION_GENERATOR: `${BASE_RULES} You produce condensed revision material: the key facts, formulae and definitions a student needs before an assessment. Prioritise what is most examinable. Omit narrative padding.`,

  LEARNING_PATH: `${BASE_RULES} You design an ordered learning path towards a stated goal. Each step builds on the last. Give a realistic time estimate per step and name what mastery looks like, so the student can tell when to move on.`,
};

/**
 * Applies the user's tone preference. Kept additive so the persona and
 * guardrails above always take precedence.
 */
export function withTone(basePrompt: string, tone: string): string {
  const tones: Record<string, string> = {
    encouraging: 'Adopt a warm, encouraging tone.',
    direct: 'Be brief and matter-of-fact. Skip pleasantries.',
    socratic: 'Prefer questions over statements — lead the student to conclusions.',
    detailed: 'Be thorough; include background and worked detail.',
  };

  const modifier = tones[tone];
  return modifier ? `${basePrompt} ${modifier}` : basePrompt;
}

// --- Response schemas -------------------------------------------------------

export const QUIZ_SCHEMA = {
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

export const EXAM_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    durationMinutes: { type: 'integer' },
    totalMarks: { type: 'integer' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'integer' },
          question: { type: 'string' },
          marks: { type: 'integer' },
          markScheme: { type: 'string' },
          topic: { type: 'string' },
        },
        required: ['number', 'question', 'marks', 'markScheme'],
      },
    },
  },
  required: ['title', 'durationMinutes', 'totalMarks', 'questions'],
} as const;

export const EXPLANATION_SCHEMA = {
  type: 'object',
  properties: {
    definition: { type: 'string' },
    explanation: { type: 'string' },
    example: { type: 'string' },
    commonMistake: { type: 'string' },
    relatedConcepts: { type: 'array', items: { type: 'string' } },
  },
  required: ['definition', 'explanation', 'example', 'commonMistake'],
} as const;

export const LEARNING_PATH_SCHEMA = {
  type: 'object',
  properties: {
    goal: { type: 'string' },
    totalHours: { type: 'integer' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          order: { type: 'integer' },
          title: { type: 'string' },
          description: { type: 'string' },
          estimatedHours: { type: 'integer' },
          masteryCheck: { type: 'string' },
        },
        required: ['order', 'title', 'description', 'estimatedHours', 'masteryCheck'],
      },
    },
  },
  required: ['goal', 'totalHours', 'steps'],
} as const;

export const REVISION_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    keyFacts: { type: 'array', items: { type: 'string' } },
    formulae: { type: 'array', items: { type: 'string' } },
    definitions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { term: { type: 'string' }, meaning: { type: 'string' } },
        required: ['term', 'meaning'],
      },
    },
    examTips: { type: 'array', items: { type: 'string' } },
  },
  required: ['topic', 'keyFacts', 'definitions'],
} as const;

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    keyPoints: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'keyPoints'],
} as const;

export const FLASHCARD_SCHEMA = {
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

/**
 * Truncates source material to a token-safe length, cutting on a paragraph
 * boundary so the model never receives a sentence sliced mid-word.
 */
export function clampSource(source: string, maxChars = 40_000): string {
  if (source.length <= maxChars) return source;

  const cut = source.slice(0, maxChars);
  const lastBreak = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('. '));

  // Only honour the boundary if it is not absurdly early in the window.
  const boundary = lastBreak > maxChars * 0.6 ? lastBreak : maxChars;
  return `${cut.slice(0, boundary).trimEnd()}\n\n[Source truncated for length.]`;
}
