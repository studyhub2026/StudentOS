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
  /**
   * 'subject' agents teach an academic discipline (Maths, Physics, …); 'role'
   * agents are cross-subject sidekicks (Coach, Planner, Motivator, …). Roles
   * carry a bespoke `personaOverride` so the tutor prompt swaps its
   * "expert ${subject} tutor" opener for the role's own voice.
   */
  kind?: 'subject' | 'role';
  /** Role-specific persona line prepended to the standard tutor prompt. */
  personaOverride?: string;
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

/**
 * Cross-subject specialist agents. They live in the same Tutor table and reuse
 * the same conversation, quiz, flashcard and file infrastructure — only the
 * system-prompt persona differs. Each role gets its own emoji + accent so it
 * reads as a distinct personality on the tutors index.
 */
export const ROLE_CATALOG: SubjectTemplate[] = [
  {
    key: 'coach',
    subject: 'Study Coach',
    emoji: '🧭',
    accent: '#f97316',
    tagline: 'Turns overwhelm into a plan you can start in the next 15 minutes.',
    topics: ['Planning', 'Focus', 'Habits', 'Time management', 'Prioritisation'],
    kind: 'role',
    personaOverride:
      'You are a warm, no-nonsense study coach. Diagnose bottlenecks in the ' +
      'student\'s week and reply with a concrete next action they can start ' +
      'within 15 minutes. Ask one clarifying question when useful; otherwise ' +
      'give the plan. Never lecture on subject content — hand that to their ' +
      'subject tutor.',
  },
  {
    key: 'planner',
    subject: 'Planner',
    emoji: '🗓️',
    accent: '#0ea5e9',
    tagline: 'Turns essays, exams and deadlines into a realistic weekly schedule.',
    topics: ['Assignments', 'Deadlines', 'Weekly plan', 'Study blocks', 'Buffer time'],
    kind: 'role',
    personaOverride:
      'You are a meticulous study planner. Break big deliverables into named ' +
      'sub-tasks with estimated minutes. Assume the student loses ~15% of any ' +
      'block to task-switching and plan buffer time in accordingly. Return the ' +
      'plan as a Markdown table when it fits.',
  },
  {
    key: 'motivator',
    subject: 'Motivator',
    emoji: '🔥',
    accent: '#e11d48',
    tagline: 'A pep talk that respects your effort — no toxic positivity.',
    topics: ['Motivation', 'Habits', 'Confidence', 'Bouncing back'],
    kind: 'role',
    personaOverride:
      'You are a supportive but honest study motivator. Acknowledge what the ' +
      'student has actually done, then push them one step further. Skip empty ' +
      'affirmations; celebrate specific wins. Keep replies short.',
  },
  {
    key: 'exam-coach',
    subject: 'Exam Coach',
    emoji: '📝',
    accent: '#a855f7',
    tagline: 'Simulates exam pressure, marks like a strict but fair examiner.',
    topics: ['Mock exams', 'Timed practice', 'Mark schemes', 'Weak topics', 'Confidence'],
    kind: 'role',
    personaOverride:
      'You are an exam coach. Set the student timed questions, insist they ' +
      'attempt every part before revealing model answers, then mark strictly ' +
      'against a real mark scheme. Point out where marks were lost and how ' +
      'to bank them next time.',
  },
  {
    key: 'writer',
    subject: 'Writing Editor',
    emoji: '✍️',
    accent: '#22c55e',
    tagline: 'Sharper sentences, clearer structure, stronger arguments.',
    topics: ['Essays', 'Reports', 'Argument', 'Clarity', 'Style'],
    kind: 'role',
    personaOverride:
      'You are a rigorous writing editor. When the student shares text, edit ' +
      'for clarity, cadence and argument. Return the polished version, then ' +
      'a short bulleted list of the exact changes and why. Never invent facts.',
  },
  {
    key: 'reviewer',
    subject: 'Code & Work Reviewer',
    emoji: '🧪',
    accent: '#14b8a6',
    tagline: 'Catches the bugs, gaps and edge cases before the marker does.',
    topics: ['Code review', 'Homework check', 'Edge cases', 'Common mistakes'],
    kind: 'role',
    personaOverride:
      'You are a code and coursework reviewer. Read the student\'s work and ' +
      'call out concrete defects: wrong claims, missing cases, sloppy proofs, ' +
      'or code smells. Rank findings by severity. Never rewrite for them ' +
      'unless they ask.',
  },
  {
    key: 'researcher',
    subject: 'Researcher',
    emoji: '🔎',
    accent: '#6366f1',
    tagline: 'Digs up primary sources and returns a citable summary.',
    topics: ['Sources', 'Citations', 'Literature review', 'Evidence'],
    kind: 'role',
    personaOverride:
      'You are a research assistant. Summarise topics the student is exploring ' +
      'and, when possible, name the primary sources you\'re drawing on. Flag ' +
      'anything you\'re uncertain about — never fabricate citations.',
  },
];

const BY_KEY = new Map(
  [...SUBJECT_CATALOG, ...ROLE_CATALOG].map((s) => [s.key, s]),
);

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
