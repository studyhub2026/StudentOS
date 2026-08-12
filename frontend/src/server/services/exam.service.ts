import 'server-only';
import { prisma } from '@/server/db';
import { NotFoundError, BadRequestError } from '@/server/lib/errors';
import { geminiService } from '@/server/services/gemini.service';

export async function saveQuestionBank(
  userId: string,
  input: { title: string; subjectId?: string; questions: unknown[] },
) {
  return prisma.questionBank.create({
    data: {
      userId,
      subjectId: input.subjectId ?? null,
      title: input.title,
      questions: input.questions as never,
    },
  });
}

export async function getQuestionBanks(userId: string, subjectId?: string) {
  return prisma.questionBank.findMany({
    where: { userId, ...(subjectId ? { subjectId } : {}) },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      subjectId: true,
      createdAt: true,
      updatedAt: true,
      subject: { select: { name: true, color: true } },
    },
  });
}

export async function getQuestionBankById(userId: string, id: string) {
  const bank = await prisma.questionBank.findFirst({ where: { id, userId } });
  if (!bank) throw new NotFoundError('Question bank');
  return bank;
}

export async function deleteQuestionBank(userId: string, id: string) {
  const bank = await prisma.questionBank.findFirst({ where: { id, userId } });
  if (!bank) throw new NotFoundError('Question bank');
  return prisma.questionBank.delete({ where: { id } });
}

export async function startExam(
  userId: string,
  input: { title: string; subjectId?: string; questions: unknown[]; totalMarks: number; duration: number },
) {
  return prisma.examAttempt.create({
    data: {
      userId,
      subjectId: input.subjectId ?? null,
      title: input.title,
      questions: input.questions as never,
      totalMarks: input.totalMarks,
      duration: input.duration,
    },
  });
}

export async function submitExam(
  userId: string,
  attemptId: string,
  answers: Record<number, string>,
) {
  const attempt = await prisma.examAttempt.findFirst({ where: { id: attemptId, userId } });
  if (!attempt) throw new NotFoundError('Exam attempt');
  if (attempt.completedAt) throw new BadRequestError('Exam already submitted');

  const questions = attempt.questions as { number: number; question: string; marks: number; markScheme: string; topic?: string }[];
  const totalMarks = attempt.totalMarks;

  let analysis: Record<string, unknown> | null = null;
  let score: number | null = null;

  try {
    const gradeResult = await geminiService.generateJson({
      systemInstruction:
        'You are an exam grader. Grade each answer against the mark scheme. ' +
        'Return a JSON object with: score (number, total marks earned), ' +
        'perQuestion (array of {number, marksAwarded, feedback}), ' +
        'strengths (string[]), weaknesses (string[]), recommendations (string[]).',
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            totalMarks,
            questions: questions.map((q) => ({
              number: q.number,
              question: q.question,
              marks: q.marks,
              markScheme: q.markScheme,
              studentAnswer: answers[q.number] ?? '(no answer)',
            })),
          }),
        },
      ],
      responseSchema: {
        type: 'object',
        properties: {
          score: { type: 'number' },
          perQuestion: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                number: { type: 'number' },
                marksAwarded: { type: 'number' },
                feedback: { type: 'string' },
              },
              required: ['number', 'marksAwarded', 'feedback'],
            },
          },
          strengths: { type: 'array', items: { type: 'string' } },
          weaknesses: { type: 'array', items: { type: 'string' } },
          recommendations: { type: 'array', items: { type: 'string' } },
        },
        required: ['score', 'perQuestion', 'strengths', 'weaknesses', 'recommendations'],
      },
      parse: (v) => v as Record<string, unknown>,
    });
    analysis = gradeResult.data;
    score = (analysis.score as number) ?? null;
  } catch {
    score = null;
    analysis = null;
  }

  return prisma.examAttempt.update({
    where: { id: attemptId },
    data: {
      answers: answers as never,
      score,
      completedAt: new Date(),
      analysis: analysis as never,
    },
  });
}

export async function getExamHistory(userId: string, subjectId?: string) {
  return prisma.examAttempt.findMany({
    where: { userId, ...(subjectId ? { subjectId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true,
      title: true,
      subjectId: true,
      score: true,
      totalMarks: true,
      duration: true,
      startedAt: true,
      completedAt: true,
      subject: { select: { name: true, color: true } },
    },
  });
}

export async function getExamAttempt(userId: string, attemptId: string) {
  const attempt = await prisma.examAttempt.findFirst({ where: { id: attemptId, userId } });
  if (!attempt) throw new NotFoundError('Exam attempt');
  return attempt;
}
