import { describe, expect, it } from 'vitest';
import {
  EXAM_SCHEMA,
  EXPLANATION_SCHEMA,
  FLASHCARD_SCHEMA,
  LEARNING_PATH_SCHEMA,
  QUIZ_SCHEMA,
  REVISION_SCHEMA,
  SUMMARY_SCHEMA,
  SYSTEM_PROMPTS,
  clampSource,
  withTone,
  type AiFeatureKey,
} from './ai-prompts';
import {
  examSchema,
  explanationSchema,
  learningPathSchema,
  revisionSchema,
} from './ai.service';

const ALL_FEATURES: AiFeatureKey[] = [
  'CHAT',
  'HOMEWORK_HELPER',
  'STUDY_PLANNER',
  'EXAM_SIMULATOR',
  'QUIZ_GENERATOR',
  'FLASHCARD_GENERATOR',
  'SUMMARIZER',
  'CONCEPT_EXPLAINER',
  'MOTIVATION_COACH',
  'REVISION_GENERATOR',
  'LEARNING_PATH',
];

describe('system prompts', () => {
  it.each(ALL_FEATURES)('defines a prompt for %s', (feature) => {
    expect(SYSTEM_PROMPTS[feature]).toBeTruthy();
    expect(SYSTEM_PROMPTS[feature].length).toBeGreaterThan(40);
  });

  it('carries the shared accuracy rules into every persona', () => {
    for (const feature of ALL_FEATURES) {
      expect(SYSTEM_PROMPTS[feature]).toContain('StudentOS AI');
      expect(SYSTEM_PROMPTS[feature]).toMatch(/never fabricate/i);
    }
  });

  it('applies the tutoring boundary to features that could do a student’s work', () => {
    // These two are the paths where a student could ask for completed work.
    expect(SYSTEM_PROMPTS.HOMEWORK_HELPER).toMatch(/never write an essay|guide the student/i);
    expect(SYSTEM_PROMPTS.CHAT).toMatch(/never write an essay|guide the student/i);
  });

  it('keeps the coach away from clinical advice', () => {
    expect(SYSTEM_PROMPTS.MOTIVATION_COACH).toMatch(/never give medical or mental-health advice/i);
  });
});

describe('tone modifiers', () => {
  it.each(['encouraging', 'direct', 'socratic', 'detailed'])(
    'appends guidance for the %s tone',
    (tone) => {
      const result = withTone('BASE.', tone);
      expect(result.startsWith('BASE.')).toBe(true);
      expect(result.length).toBeGreaterThan('BASE.'.length);
    },
  );

  it('leaves the prompt untouched for an unknown tone', () => {
    expect(withTone('BASE.', 'nonsense')).toBe('BASE.');
  });

  it('never drops the original instructions', () => {
    const base = SYSTEM_PROMPTS.CHAT;
    expect(withTone(base, 'direct')).toContain(base);
  });
});

describe('source clamping', () => {
  it('leaves short input untouched', () => {
    expect(clampSource('short material')).toBe('short material');
  });

  it('truncates oversized input and says so', () => {
    const clamped = clampSource('word '.repeat(20_000), 1000);
    expect(clamped.length).toBeLessThan(1200);
    expect(clamped).toContain('[Source truncated for length.]');
  });

  it('cuts on a paragraph boundary when one is available late in the window', () => {
    const source = `${'a'.repeat(700)}\n\n${'b'.repeat(700)}`;
    const clamped = clampSource(source, 1000);
    // The break at 700 is past 60% of 1000, so it should be honoured.
    expect(clamped).not.toContain('b');
  });

  it('falls back to a hard cut when the only boundary is too early', () => {
    const source = `intro\n\n${'x'.repeat(5000)}`;
    const clamped = clampSource(source, 1000);
    expect(clamped).toContain('x');
  });

  it('handles input exactly at the limit', () => {
    const exact = 'y'.repeat(1000);
    expect(clampSource(exact, 1000)).toBe(exact);
  });
});

describe('response schemas are well-formed', () => {
  const schemas = {
    QUIZ_SCHEMA,
    EXAM_SCHEMA,
    EXPLANATION_SCHEMA,
    LEARNING_PATH_SCHEMA,
    REVISION_SCHEMA,
    SUMMARY_SCHEMA,
    FLASHCARD_SCHEMA,
  };

  it.each(Object.entries(schemas))('%s declares every required field', (_name, schema) => {
    const typed = schema as unknown as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(typed.type).toBe('object');
    // A required key that is not declared in properties would be silently
    // ignored by the model and produce output we cannot parse.
    for (const key of typed.required) {
      expect(Object.keys(typed.properties)).toContain(key);
    }
  });
});

describe('model output validation', () => {
  it('accepts a well-formed exam', () => {
    const result = examSchema.safeParse({
      title: 'Cell Biology Paper 1',
      durationMinutes: 60,
      totalMarks: 40,
      questions: [
        { number: 1, question: 'Describe osmosis.', marks: 6, markScheme: 'Award 1 mark per point.' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an exam with no questions', () => {
    const result = examSchema.safeParse({
      title: 'Empty',
      durationMinutes: 60,
      totalMarks: 40,
      questions: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an exam question missing its mark scheme', () => {
    const result = examSchema.safeParse({
      title: 'Paper',
      durationMinutes: 60,
      totalMarks: 10,
      questions: [{ number: 1, question: 'Q', marks: 5 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive marks', () => {
    const result = examSchema.safeParse({
      title: 'Paper',
      durationMinutes: 60,
      totalMarks: 10,
      questions: [{ number: 1, question: 'Q', marks: 0, markScheme: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a complete concept explanation', () => {
    expect(
      explanationSchema.safeParse({
        definition: 'A limit describes the value a function approaches.',
        explanation: 'Longer prose.',
        example: 'Worked example.',
        commonMistake: 'Confusing the limit with the value at the point.',
        relatedConcepts: ['continuity'],
      }).success,
    ).toBe(true);
  });

  it('defaults relatedConcepts when the model omits it', () => {
    const result = explanationSchema.parse({
      definition: 'd',
      explanation: 'e',
      example: 'x',
      commonMistake: 'm',
    });
    expect(result.relatedConcepts).toEqual([]);
  });

  it('rejects an explanation missing the common mistake', () => {
    expect(
      explanationSchema.safeParse({ definition: 'd', explanation: 'e', example: 'x' }).success,
    ).toBe(false);
  });

  it('rejects a learning path with no steps', () => {
    expect(
      learningPathSchema.safeParse({ goal: 'Learn calculus', totalHours: 40, steps: [] }).success,
    ).toBe(false);
  });

  it('rejects a learning path step with a zero time estimate', () => {
    expect(
      learningPathSchema.safeParse({
        goal: 'g',
        totalHours: 10,
        steps: [
          { order: 1, title: 't', description: 'd', estimatedHours: 0, masteryCheck: 'm' },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts a revision sheet with only the required fields', () => {
    const result = revisionSchema.parse({
      topic: 'Thermodynamics',
      keyFacts: ['Energy is conserved.'],
      definitions: [{ term: 'Entropy', meaning: 'A measure of disorder.' }],
    });
    // Optional collections default rather than arriving undefined.
    expect(result.formulae).toEqual([]);
    expect(result.examTips).toEqual([]);
  });

  it('rejects a definition missing its meaning', () => {
    expect(
      revisionSchema.safeParse({
        topic: 't',
        keyFacts: [],
        definitions: [{ term: 'Entropy' }],
      }).success,
    ).toBe(false);
  });

  it('rejects empty strings that passed the model’s own schema', () => {
    // Gemini can satisfy "type: string" with "", which is useless to render.
    expect(
      revisionSchema.safeParse({
        topic: '',
        keyFacts: [],
        definitions: [],
      }).success,
    ).toBe(false);
  });
});
