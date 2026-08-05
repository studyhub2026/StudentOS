import 'server-only';
import type { TutorDifficulty } from '@prisma/client';

/**
 * Prompt construction for the subject tutors.
 *
 * A tutor's system instruction is assembled from four layers, in order:
 *   1. shared guardrails (accuracy, no fabrication, teach-don't-do)
 *   2. the subject persona
 *   3. the difficulty adaptation
 *   4. the student's own learning context (progress, style, goals, files)
 *
 * Layer 4 is what makes each tutor personal and prevents leakage — only that
 * tutor's progress and files are ever injected.
 */

const BASE_RULES = [
  'You are part of StudentOS AI, a study platform used by school and university students.',
  'Be accurate. If you are unsure, say so plainly rather than guessing.',
  'Never fabricate citations, statistics, dates, formulae or quotations.',
  'Use clear formatting: short paragraphs, lists where they help, fenced code blocks for code, and LaTeX ($…$ or $$…$$) for mathematics.',
].join(' ');

const TUTOR_BOUNDARY = [
  'Teach the student rather than doing their work for them.',
  'Explain the method, work a similar example, and invite them to attempt the next step.',
  'If they explicitly ask for a final answer, give it — but always with the reasoning that produces it.',
  'Never write a whole essay, report or assignment for them to submit as their own.',
].join(' ');

const DIFFICULTY_GUIDANCE: Record<TutorDifficulty, string> = {
  BEGINNER:
    'Pitch explanations at a beginner. Assume little prior knowledge, define terms as you use them, ' +
    'favour intuition and concrete analogies over formalism, and keep steps small.',
  INTERMEDIATE:
    'Pitch explanations at an intermediate student. Assume the fundamentals are in place, move at a ' +
    'steady pace, and introduce standard notation and terminology without labouring the basics.',
  ADVANCED:
    'Pitch explanations at an advanced student. Be rigorous and concise, use precise terminology and ' +
    'formal notation, and do not rehearse elementary background unless asked.',
  ADAPTIVE:
    'Adapt the difficulty to the student. Read their questions and past performance: simplify and slow ' +
    'down where they struggle, and raise the rigour where they are confident. State a term the first ' +
    'time you judge it may be new to them.',
};

export interface TutorProgressSnapshot {
  weakTopics: string[];
  strongTopics: string[];
  masteryScore: number;
  confidenceScore: number;
  quizzesTaken: number;
  quizCorrect: number;
  quizQuestions: number;
}

export interface BuildPromptInput {
  subject: string;
  difficulty: TutorDifficulty;
  explanationStyle?: string | null;
  goals?: string | null;
  progress?: TutorProgressSnapshot | null;
  /** Long-term, cross-subject facts (name, level…) from global AI memory. */
  memoryContext?: string;
  /** Labelled contents of files attached to this tutor's conversation. */
  fileContext?: string;
  /**
   * For role-based agents (Coach, Planner, Motivator, …) this replaces the
   * default "expert ${subject} tutor" persona line — the rest of the prompt
   * (rules, difficulty, progress, memory) still applies.
   */
  personaOverride?: string;
}

function progressBlock(progress: TutorProgressSnapshot): string {
  const lines: string[] = [];
  if (progress.strongTopics.length) {
    lines.push(`Confident with: ${progress.strongTopics.join(', ')}.`);
  }
  if (progress.weakTopics.length) {
    lines.push(`Struggles with (reinforce these gently): ${progress.weakTopics.join(', ')}.`);
  }
  if (progress.quizzesTaken > 0 && progress.quizQuestions > 0) {
    const pct = Math.round((progress.quizCorrect / progress.quizQuestions) * 100);
    lines.push(`Quiz record: ${progress.quizCorrect}/${progress.quizQuestions} correct (${pct}%).`);
  }
  if (progress.masteryScore > 0) {
    lines.push(`Estimated mastery so far: ${Math.round(progress.masteryScore)}%.`);
  }
  return lines.length
    ? `What you know about this student's progress in this subject (use it to personalise; do not recite it back):\n- ${lines.join('\n- ')}`
    : '';
}

/** Assembles the full system instruction for a tutor turn. */
export function buildTutorSystemPrompt(input: BuildPromptInput): string {
  const persona = input.personaOverride
    ? `${input.personaOverride} ${TUTOR_BOUNDARY}`
    : `You are an expert ${input.subject} tutor: knowledgeable, patient and encouraging. ` +
      `You only teach ${input.subject} — if a student asks about an unrelated subject, help briefly but ` +
      `steer back, and suggest they use that subject's own tutor. ${TUTOR_BOUNDARY}`;

  const style = input.explanationStyle
    ? `The student prefers explanations in this style: ${input.explanationStyle}. Honour it where you can.`
    : '';

  const goals = input.goals ? `The student's stated goal: ${input.goals}. Keep your help aligned to it.` : '';

  return [
    BASE_RULES,
    persona,
    DIFFICULTY_GUIDANCE[input.difficulty],
    style,
    goals,
    input.progress ? progressBlock(input.progress) : '',
    input.memoryContext ?? '',
    input.fileContext ?? '',
  ]
    .filter((part) => part && part.trim().length > 0)
    .join('\n\n');
}

// --- Quick-action templates -------------------------------------------------

/**
 * Templated prompts behind the chat's quick actions. Each returns the user
 * message text to send; the tutor's persona and context handle the rest, so
 * every capability in the spec is reachable without a bespoke endpoint.
 */
export const QUICK_ACTIONS = {
  explain: (topic: string) => `Explain the concept of "${topic}" clearly, with a concrete example.`,
  example: (topic: string) => `Give me a worked example involving "${topic}", solved step by step.`,
  practice: (topic: string) =>
    `Give me 3 practice questions on "${topic}", from easier to harder. Don't include the answers yet — I'll attempt them first.`,
  hint: (problem: string) =>
    `I'm stuck on this problem. Give me a hint to get unstuck, not the full solution:\n\n${problem}`,
  compare: (a: string, b: string) =>
    `Compare and contrast "${a}" and "${b}": how they're similar, how they differ, and when each applies.`,
  summary: (topic: string) => `Write concise revision notes summarising "${topic}".`,
  studyPlan: (goal: string) =>
    `Recommend a focused study plan to help me reach this goal: ${goal}. Order it so each step builds on the last.`,
  explainMistake: (mistake: string) =>
    `I made this mistake: ${mistake}. Explain why it's wrong and how to avoid it next time.`,
} as const;

// --- Structured generation schemas ------------------------------------------

/** A quiz the tutor generates on demand, stored on the message's `data`. */
export const TUTOR_QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    topic: { type: 'string' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correctIndex: { type: 'integer' },
          explanation: { type: 'string' },
          topic: { type: 'string' },
        },
        required: ['question', 'options', 'correctIndex', 'explanation'],
      },
    },
  },
  required: ['title', 'topic', 'questions'],
} as const;

export const TUTOR_FLASHCARD_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
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
  required: ['topic', 'cards'],
} as const;

/** The insight snapshot the tutor generates from progress + recent history. */
export const TUTOR_INSIGHT_SCHEMA = {
  type: 'object',
  properties: {
    todaysRecommendation: { type: 'string' },
    suggestedRevision: { type: 'string' },
    weakTopics: { type: 'array', items: { type: 'string' } },
    strongTopics: { type: 'array', items: { type: 'string' } },
    estimatedMastery: { type: 'integer' },
    confidenceScore: { type: 'integer' },
    summary: { type: 'string' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['kind', 'title'],
      },
    },
  },
  required: ['todaysRecommendation', 'weakTopics', 'estimatedMastery', 'confidenceScore', 'summary'],
} as const;

/** Facts extracted from a tutoring turn to update the student's progress. */
export const TUTOR_LEARNING_SCHEMA = {
  type: 'object',
  properties: {
    weakTopics: { type: 'array', items: { type: 'string' } },
    strongTopics: { type: 'array', items: { type: 'string' } },
    mistakes: { type: 'array', items: { type: 'string' } },
    goals: { type: 'string' },
    explanationStyle: { type: 'string' },
  },
  required: [],
} as const;
