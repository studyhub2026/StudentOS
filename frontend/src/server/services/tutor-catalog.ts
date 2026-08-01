import 'server-only';

/**
 * The catalogue of subject tutors offered to every student. A student's actual
 * {@link Tutor} rows are created lazily from these templates the first time a
 * subject is opened, so the dashboard can always show the full set of subjects
 * whether or not the student has used them yet.
 *
 * This is a free product — every subject is available to everyone. There is no
 * paid tier and no gating.
 */

export interface SubjectTemplate {
  key: string;
  subject: string;
  emoji: string;
  accent: string;
  tagline: string;
  /** Seed topics used to steer the first insights before real history exists. */
  topics: string[];
}

export const SUBJECT_CATALOG: SubjectTemplate[] = [
  {
    key: 'mathematics',
    subject: 'Mathematics',
    emoji: '📐',
    accent: '#6366f1',
    tagline: 'Algebra, calculus, geometry and proof — worked step by step.',
    topics: ['Algebra', 'Calculus', 'Trigonometry', 'Geometry', 'Probability', 'Linear algebra'],
  },
  {
    key: 'physics',
    subject: 'Physics',
    emoji: '🔭',
    accent: '#0ea5e9',
    tagline: 'Mechanics to quantum — the intuition and the maths behind it.',
    topics: ['Mechanics', 'Electromagnetism', 'Thermodynamics', 'Waves', 'Quantum', 'Relativity'],
  },
  {
    key: 'chemistry',
    subject: 'Chemistry',
    emoji: '⚗️',
    accent: '#14b8a6',
    tagline: 'Reactions, bonding and equations that actually balance.',
    topics: ['Atomic structure', 'Bonding', 'Stoichiometry', 'Organic', 'Equilibria', 'Electrochemistry'],
  },
  {
    key: 'biology',
    subject: 'Biology',
    emoji: '🧬',
    accent: '#22c55e',
    tagline: 'Cells, systems and genetics, explained without the jargon wall.',
    topics: ['Cell biology', 'Genetics', 'Physiology', 'Ecology', 'Evolution', 'Biochemistry'],
  },
  {
    key: 'programming',
    subject: 'Programming',
    emoji: '💻',
    accent: '#a855f7',
    tagline: 'Code, algorithms and debugging — with runnable examples.',
    topics: ['Data structures', 'Algorithms', 'Web development', 'OOP', 'Databases', 'Debugging'],
  },
  {
    key: 'history',
    subject: 'History',
    emoji: '🏛️',
    accent: '#f59e0b',
    tagline: 'Causes, consequences and the sources behind the dates.',
    topics: ['Ancient', 'Medieval', 'Modern', 'World wars', 'Revolutions', 'Historiography'],
  },
  {
    key: 'english',
    subject: 'English',
    emoji: '✍️',
    accent: '#ec4899',
    tagline: 'Close reading, essays and grammar that hold together.',
    topics: ['Literary analysis', 'Essay writing', 'Grammar', 'Poetry', 'Rhetoric', 'Comprehension'],
  },
  {
    key: 'economics',
    subject: 'Economics',
    emoji: '📈',
    accent: '#ef4444',
    tagline: 'Micro, macro and the models — with the graphs drawn out.',
    topics: ['Microeconomics', 'Macroeconomics', 'Markets', 'Trade', 'Policy', 'Econometrics'],
  },
  {
    key: 'computer-science',
    subject: 'Computer Science',
    emoji: '🧠',
    accent: '#3b82f6',
    tagline: 'Theory, systems and complexity beyond just writing code.',
    topics: ['Complexity', 'Operating systems', 'Networks', 'Databases', 'AI', 'Theory of computation'],
  },
  {
    key: 'geography',
    subject: 'Geography',
    emoji: '🌍',
    accent: '#10b981',
    tagline: 'Physical and human geography, mapped to real places.',
    topics: ['Physical geography', 'Human geography', 'Climate', 'Urbanisation', 'Maps', 'Development'],
  },
];

const BY_KEY = new Map(SUBJECT_CATALOG.map((s) => [s.key, s]));

export function catalogEntry(key: string): SubjectTemplate | undefined {
  return BY_KEY.get(key);
}

/** Turns a free-text subject name into a stable slug for a custom tutor. */
export function slugifySubject(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'subject'
  );
}
