import { describe, expect, it } from 'vitest';
import type { TutorDifficulty } from '@prisma/client';
import {
  QUICK_ACTIONS,
  TUTOR_FLASHCARD_SCHEMA,
  TUTOR_INSIGHT_SCHEMA,
  TUTOR_QUIZ_SCHEMA,
  buildTutorSystemPrompt,
} from './tutor-prompts';
import { SUBJECT_CATALOG, catalogEntry, slugifySubject } from './tutor-catalog';

const DIFFICULTIES: TutorDifficulty[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ADAPTIVE'];

describe('buildTutorSystemPrompt', () => {
  it('names the subject and pins the tutor to it', () => {
    const prompt = buildTutorSystemPrompt({ subject: 'Physics', difficulty: 'ADAPTIVE' });
    expect(prompt).toContain('Physics tutor');
    expect(prompt).toMatch(/only teach Physics/i);
  });

  it('carries the shared accuracy and teaching-boundary rules', () => {
    const prompt = buildTutorSystemPrompt({ subject: 'Maths', difficulty: 'BEGINNER' });
    expect(prompt).toContain('StudentOS AI');
    expect(prompt).toMatch(/never fabricate/i);
    expect(prompt).toMatch(/Teach the student rather than doing their work/i);
  });

  it('applies a distinct difficulty band for each level', () => {
    const prompts = DIFFICULTIES.map((d) => buildTutorSystemPrompt({ subject: 'Biology', difficulty: d }));
    // Each level's guidance is present and they are not all identical.
    expect(prompts[0]).toMatch(/beginner/i);
    expect(prompts[2]).toMatch(/advanced|rigorous/i);
    expect(new Set(prompts).size).toBe(DIFFICULTIES.length);
  });

  it('folds in progress, style and goals when supplied', () => {
    const prompt = buildTutorSystemPrompt({
      subject: 'Chemistry',
      difficulty: 'INTERMEDIATE',
      explanationStyle: 'lots of analogies',
      goals: 'pass my finals',
      progress: {
        weakTopics: ['stoichiometry'],
        strongTopics: ['bonding'],
        masteryScore: 55,
        confidenceScore: 60,
        quizzesTaken: 2,
        quizCorrect: 7,
        quizQuestions: 10,
      },
    });
    expect(prompt).toContain('stoichiometry');
    expect(prompt).toContain('bonding');
    expect(prompt).toMatch(/analogies/);
    expect(prompt).toMatch(/pass my finals/);
    expect(prompt).toMatch(/70%/); // 7/10 quiz record
  });

  it('swaps in the role persona and drops the "expert subject tutor" opener', () => {
    const prompt = buildTutorSystemPrompt({
      subject: 'Study Coach',
      difficulty: 'ADAPTIVE',
      personaOverride:
        'You are a warm, no-nonsense study coach who diagnoses bottlenecks.',
    });
    expect(prompt).toContain('warm, no-nonsense study coach');
    expect(prompt).not.toMatch(/expert Study Coach tutor/);
    // Shared teaching-boundary rule still applies.
    expect(prompt).toMatch(/Teach the student rather than doing their work/i);
  });

  it('omits the progress block entirely when there is nothing to report', () => {
    const prompt = buildTutorSystemPrompt({
      subject: 'History',
      difficulty: 'ADAPTIVE',
      progress: {
        weakTopics: [],
        strongTopics: [],
        masteryScore: 0,
        confidenceScore: 0,
        quizzesTaken: 0,
        quizCorrect: 0,
        quizQuestions: 0,
      },
    });
    expect(prompt).not.toMatch(/progress in this subject/i);
  });
});

describe('quick action templates', () => {
  it('substitutes the topic into every template', () => {
    expect(QUICK_ACTIONS.explain('vectors')).toContain('vectors');
    expect(QUICK_ACTIONS.compare('a', 'b')).toContain('a');
    expect(QUICK_ACTIONS.compare('a', 'b')).toContain('b');
    expect(QUICK_ACTIONS.hint('2x+1=5')).toContain('2x+1=5');
  });
});

describe('generation schemas are well-formed', () => {
  const schemas = { TUTOR_QUIZ_SCHEMA, TUTOR_FLASHCARD_SCHEMA, TUTOR_INSIGHT_SCHEMA };
  it.each(Object.entries(schemas))('%s declares every required field', (_name, schema) => {
    const typed = schema as unknown as { type: string; properties: Record<string, unknown>; required: string[] };
    expect(typed.type).toBe('object');
    for (const key of typed.required) {
      expect(Object.keys(typed.properties)).toContain(key);
    }
  });
});

describe('subject catalogue', () => {
  it('has unique keys', () => {
    const keys = SUBJECT_CATALOG.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('resolves a known subject and rejects an unknown one', () => {
    expect(catalogEntry('mathematics')?.subject).toBe('Mathematics');
    expect(catalogEntry('astrology')).toBeUndefined();
  });

  it('slugifies free-text subjects safely', () => {
    expect(slugifySubject('Organic Chemistry!')).toBe('organic-chemistry');
    expect(slugifySubject('   ')).toBe('subject');
  });
});
