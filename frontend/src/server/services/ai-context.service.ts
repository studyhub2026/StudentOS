import 'server-only';
import { AssignmentStatus } from '@prisma/client';
import { prisma } from '@/server/db';

/**
 * Retrieves academic context for AI chat based on the user's message.
 *
 * Uses keyword/pattern matching to detect intent (no AI call needed) and pulls
 * only the relevant data slices so the model gets useful context without
 * flooding it with the entire database.
 */

interface ContextSignals {
  schedule: boolean;
  assignments: boolean;
  exams: boolean;
  grades: boolean;
  study: boolean;
  courses: boolean;
  matchedSubjects: string[];
}

const SCHEDULE_PATTERNS = /\b(tomorrow|today|tonight|this week|next week|class|classes|lecture|lectures|lab|labs|timetable|schedule|calendar|what('s| is| do i have) (on|coming|happening|planned))\b/i;
const ASSIGNMENT_PATTERNS = /\b(assignment|assignments|homework|homeworks|due|deadline|deadlines|submission|submit|task|tasks|project|coursework)\b/i;
const EXAM_PATTERNS = /\b(exam|exams|test|tests|midterm|midterms|final|finals|quiz|quizzes|assessment|revision|revise|prepare|prepared|preparation)\b/i;
const GRADE_PATTERNS = /\b(grade|grades|gpa|score|scores|mark|marks|performance|result|results|average|passing|failing|transcript)\b/i;
const STUDY_PATTERNS = /\b(study|studying|review|reviewed|prepare|focus|pomodoro|session|streak|productivity|progress|analytics|how am i doing|how('m| am) i (doing|performing))\b/i;
const COURSE_PATTERNS = /\b(course|courses|subject|subjects|module|modules|class|classes|enroll|enrolled|registered)\b/i;

function detectSignals(message: string, subjectNames: string[]): ContextSignals {
  const lower = message.toLowerCase();
  const signals: ContextSignals = {
    schedule: SCHEDULE_PATTERNS.test(message),
    assignments: ASSIGNMENT_PATTERNS.test(message),
    exams: EXAM_PATTERNS.test(message),
    grades: GRADE_PATTERNS.test(message),
    study: STUDY_PATTERNS.test(message),
    courses: COURSE_PATTERNS.test(message),
    matchedSubjects: [],
  };

  for (const name of subjectNames) {
    if (lower.includes(name.toLowerCase())) {
      signals.matchedSubjects.push(name);
    }
  }

  // If a specific subject is mentioned, pull its assignments and schedule too
  if (signals.matchedSubjects.length > 0) {
    signals.assignments = true;
    signals.schedule = true;
  }

  return signals;
}

function hasAnySignal(signals: ContextSignals): boolean {
  return (
    signals.schedule ||
    signals.assignments ||
    signals.exams ||
    signals.grades ||
    signals.study ||
    signals.courses ||
    signals.matchedSubjects.length > 0
  );
}

async function fetchScheduleContext(
  userId: string,
  subjectIds: string[],
): Promise<string> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(todayStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const blocks = await prisma.scheduleBlock.findMany({
    where: {
      userId,
      startAt: { gte: todayStart, lt: weekEnd },
      ...(subjectIds.length > 0 ? { subjectId: { in: subjectIds } } : {}),
    },
    include: { subject: { select: { name: true } } },
    orderBy: { startAt: 'asc' },
    take: 30,
  });

  if (blocks.length === 0) return '';

  const lines = blocks.map((b) => {
    const day = b.startAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const time = b.startAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const endTime = b.endAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const subject = b.subject?.name ? ` [${b.subject.name}]` : '';
    const location = b.location ? ` at ${b.location}` : '';
    return `- ${day} ${time}–${endTime}: ${b.title} (${b.type})${subject}${location}`;
  });

  return `## Schedule (next 7 days)\n${lines.join('\n')}`;
}

async function fetchAssignmentContext(
  userId: string,
  subjectIds: string[],
): Promise<string> {
  const now = new Date();
  const twoWeeksOut = new Date(now);
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

  const assignments = await prisma.assignment.findMany({
    where: {
      userId,
      deletedAt: null,
      status: { notIn: [AssignmentStatus.COMPLETED, AssignmentStatus.ARCHIVED] },
      ...(subjectIds.length > 0 ? { subjectId: { in: subjectIds } } : {}),
    },
    include: { subject: { select: { name: true } } },
    orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
    take: 20,
  });

  if (assignments.length === 0) return '';

  const lines = assignments.map((a) => {
    const due = a.dueAt
      ? a.dueAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : 'no due date';
    const overdue = a.dueAt && a.dueAt < now ? ' ⚠ OVERDUE' : '';
    const subject = a.subject?.name ? ` [${a.subject.name}]` : '';
    return `- ${a.title}${subject} — ${a.status}, due ${due}, priority ${a.priority}${overdue}`;
  });

  return `## Active Assignments\n${lines.join('\n')}`;
}

async function fetchExamContext(userId: string, subjectIds: string[]): Promise<string> {
  const now = new Date();
  const threeMonths = new Date(now);
  threeMonths.setDate(threeMonths.getDate() + 90);

  const exams = await prisma.scheduleBlock.findMany({
    where: {
      userId,
      type: 'EXAM',
      startAt: { gte: now, lt: threeMonths },
      ...(subjectIds.length > 0 ? { subjectId: { in: subjectIds } } : {}),
    },
    include: { subject: { select: { name: true } } },
    orderBy: { startAt: 'asc' },
    take: 15,
  });

  // Also pull weak topics from tutor progress
  const weakTopics = await prisma.tutorProgress.findMany({
    where: {
      tutor: { userId },
      weakTopics: { isEmpty: false },
    },
    include: { tutor: { select: { subject: true, subjectKey: true } } },
    take: 10,
  });

  const parts: string[] = [];

  if (exams.length > 0) {
    const examLines = exams.map((e) => {
      const day = e.startAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const time = e.startAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      const daysUntil = Math.ceil((e.startAt.getTime() - now.getTime()) / 86400000);
      const subject = e.subject?.name ? ` [${e.subject.name}]` : '';
      const location = e.location ? ` at ${e.location}` : '';
      return `- ${e.title}${subject} — ${day} ${time}${location} (${daysUntil} days away)`;
    });
    parts.push(`## Upcoming Exams\n${examLines.join('\n')}`);
  }

  if (weakTopics.length > 0) {
    const topicLines = weakTopics.map((tp) => {
      const topics = (tp.weakTopics as string[]).slice(0, 5).join(', ');
      return `- ${tp.tutor.subject}: ${topics} (mastery ${tp.masteryScore}%)`;
    });
    parts.push(`## Weak Topics\n${topicLines.join('\n')}`);
  }

  return parts.join('\n\n');
}

async function fetchGradeContext(userId: string, subjectIds: string[]): Promise<string> {
  const grades = await prisma.lmsGrade.findMany({
    where: {
      connection: { userId },
      ...(subjectIds.length > 0
        ? { course: { localSubjectId: { in: subjectIds } } }
        : {}),
    },
    include: { course: { select: { name: true } } },
    orderBy: { postedAt: 'desc' },
    take: 20,
  });

  // Also get assignment grades
  const gradedAssignments = await prisma.assignment.findMany({
    where: {
      userId,
      deletedAt: null,
      grade: { not: null },
      ...(subjectIds.length > 0 ? { subjectId: { in: subjectIds } } : {}),
    },
    include: { subject: { select: { name: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 15,
  });

  const parts: string[] = [];

  if (grades.length > 0) {
    const gradeLines = grades.map((g) => {
      const score = g.percentage != null ? `${g.percentage}%` : g.letterGrade ?? `${g.score}`;
      return `- ${g.label} [${g.course?.name ?? 'Unknown'}]: ${score}`;
    });
    parts.push(`## LMS Grades\n${gradeLines.join('\n')}`);
  }

  if (gradedAssignments.length > 0) {
    const lines = gradedAssignments.map((a) => {
      const subject = a.subject?.name ?? 'General';
      return `- ${a.title} [${subject}]: ${a.grade}%`;
    });
    parts.push(`## Assignment Grades\n${lines.join('\n')}`);
  }

  // GPA from subjects
  const subjects = await prisma.subject.findMany({
    where: { userId },
    select: { name: true, targetGrade: true },
  });
  if (subjects.length > 0) {
    const subjectLines = subjects.map(
      (s) => `- ${s.name}${s.targetGrade ? ` (target: ${s.targetGrade})` : ''}`,
    );
    parts.push(`## Enrolled Subjects\n${subjectLines.join('\n')}`);
  }

  return parts.join('\n\n');
}

async function fetchStudyContext(userId: string): Promise<string> {
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [user, recentSessions, dailyStats] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { currentStreak: true, longestStreak: true, totalXp: true, level: true },
    }),
    prisma.studySession.findMany({
      where: { userId, startedAt: { gte: sevenDaysAgo } },
      select: { durationSeconds: true, type: true, focusScore: true },
    }),
    prisma.dailyStat.findMany({
      where: { userId, date: { gte: sevenDaysAgo } },
      orderBy: { date: 'desc' },
      take: 7,
    }),
  ]);

  const totalMinutes = recentSessions.reduce(
    (sum, s) => sum + Math.round((s.durationSeconds ?? 0) / 60),
    0,
  );
  const avgFocus = recentSessions.length > 0
    ? Math.round(
        recentSessions.reduce((sum, s) => sum + (s.focusScore ?? 0), 0) / recentSessions.length,
      )
    : 0;

  const parts: string[] = [];

  parts.push(`## Study Stats (last 7 days)`);
  parts.push(`- Total study time: ${totalMinutes} minutes across ${recentSessions.length} sessions`);
  parts.push(`- Average focus score: ${avgFocus}/100`);
  if (user) {
    parts.push(`- Current streak: ${user.currentStreak} days (best: ${user.longestStreak})`);
    parts.push(`- Level ${user.level}, ${user.totalXp} XP`);
  }

  if (dailyStats.length > 0) {
    const recentDays = dailyStats.slice(0, 3).map((d) => {
      const date = d.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return `  ${date}: ${Math.round(d.studySeconds / 60)}m study, ${d.assignmentsCompleted} assignments, ${d.cardsReviewed} cards`;
    });
    parts.push(`- Recent days:\n${recentDays.join('\n')}`);
  }

  return parts.join('\n');
}

async function fetchCourseContext(
  userId: string,
  subjectIds: string[],
): Promise<string> {
  const subjects = await prisma.subject.findMany({
    where: {
      userId,
      ...(subjectIds.length > 0 ? { id: { in: subjectIds } } : {}),
    },
    include: {
      _count: {
        select: { assignments: true, scheduleBlocks: true, notes: true, decks: true },
      },
    },
  });

  if (subjects.length === 0) return '';

  const lines = subjects.map((s) => {
    const teacher = s.teacherName ? `, taught by ${s.teacherName}` : '';
    const room = s.room ? `, room ${s.room}` : '';
    return `- ${s.name}${s.code ? ` (${s.code})` : ''}${teacher}${room} — ${s._count.assignments} assignments, ${s._count.notes} notes, ${s._count.decks} decks, ${s._count.scheduleBlocks} schedule blocks`;
  });

  return `## Courses/Subjects\n${lines.join('\n')}`;
}

export async function retrieveAcademicContext(
  userId: string,
  message: string,
): Promise<string> {
  // Load subject names for fuzzy matching
  const subjects = await prisma.subject.findMany({
    where: { userId },
    select: { id: true, name: true },
  });

  const signals = detectSignals(
    message,
    subjects.map((s) => s.name),
  );

  if (!hasAnySignal(signals)) return '';

  // Resolve matched subject names to IDs
  const matchedSubjectIds = signals.matchedSubjects
    .map((name) => subjects.find((s) => s.name.toLowerCase() === name.toLowerCase())?.id)
    .filter((id): id is string => id != null);

  const contextParts = await Promise.all([
    signals.schedule ? fetchScheduleContext(userId, matchedSubjectIds) : '',
    signals.assignments ? fetchAssignmentContext(userId, matchedSubjectIds) : '',
    signals.exams ? fetchExamContext(userId, matchedSubjectIds) : '',
    signals.grades ? fetchGradeContext(userId, matchedSubjectIds) : '',
    signals.study ? fetchStudyContext(userId) : '',
    signals.courses ? fetchCourseContext(userId, matchedSubjectIds) : '',
  ]);

  const context = contextParts.filter(Boolean).join('\n\n');
  if (!context) return '';

  return `The following is the student's real academic data from OmnelOS. Use it to answer their question accurately. Do not invent data beyond what is shown.\n\n${context}`;
}

/**
 * Explicit context the user attached via the composer's context selector.
 * Unlike retrieveAcademicContext (which guesses from the message), this pulls
 * exactly the notes/subjects/documents the user pointed at. Everything is
 * ownership-checked and bounded so we never ship a whole note body or the
 * entire DB to the model.
 */
export async function buildExplicitContext(
  userId: string,
  refs: { type: 'note' | 'subject' | 'document'; id: string }[],
): Promise<string> {
  if (refs.length === 0) return '';
  const noteIds = refs.filter((r) => r.type === 'note').map((r) => r.id).slice(0, 5);
  const subjectIds = refs.filter((r) => r.type === 'subject').map((r) => r.id).slice(0, 3);
  const docIds = refs.filter((r) => r.type === 'document').map((r) => r.id).slice(0, 3);

  const [notes, subjects, docs] = await Promise.all([
    noteIds.length
      ? prisma.note.findMany({
          where: { id: { in: noteIds }, userId, deletedAt: null },
          select: { title: true, excerpt: true, content: true },
        })
      : Promise.resolve([]),
    subjectIds.length
      ? prisma.subject.findMany({
          where: { id: { in: subjectIds }, userId },
          select: { name: true, code: true },
        })
      : Promise.resolve([]),
    docIds.length
      ? prisma.knowledgeDocument.findMany({
          where: { id: { in: docIds }, userId },
          select: { filename: true, extractedText: true },
        })
      : Promise.resolve([]),
  ]);

  const parts: string[] = [];
  for (const s of subjects) parts.push(`Subject: ${s.name}${s.code ? ` (${s.code})` : ''}`);
  for (const n of notes) {
    const body = (n.excerpt ?? n.content ?? '').slice(0, 800);
    parts.push(`Note "${n.title}":\n${body}`);
  }
  for (const d of docs) {
    const body = (d.extractedText ?? '').slice(0, 1500);
    parts.push(`Document "${d.filename}":\n${body}`);
  }

  if (parts.length === 0) return '';
  return `The student attached the following material as context for this question. Ground your answer in it.\n\n${parts.join('\n\n')}`;
}

export const aiContextService = { retrieveAcademicContext, buildExplicitContext } as const;
