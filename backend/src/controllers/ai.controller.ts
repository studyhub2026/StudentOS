import type { AiFeature } from '@prisma/client';
import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { aiService } from '../services/ai.service.js';
import { aiStudyService } from '../services/ai-study.service.js';
import { UnauthorizedError } from '../utils/errors.js';
import type {
  CoachInput,
  ExplainConceptInput,
  GenerateExamInput,
  LearningPathInput,
  RevisionSheetInput,
  SendMessageInput,
} from '../validators/ai.validator.js';

function userId(req: Request): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}

/** Reports which AI features are available, so the UI can degrade cleanly. */
export function status(_req: Request, res: Response): void {
  res.json({
    success: true,
    data: {
      configured: aiService.isConfigured(),
      provider: 'google-gemini',
      features: [
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
      ],
    },
  });
}

// --- Conversations ----------------------------------------------------------

export async function listConversations(req: Request, res: Response): Promise<void> {
  const feature = req.query.feature as AiFeature | undefined;
  res.json({ success: true, data: await aiService.listConversations(userId(req), feature) });
}

export async function getConversation(req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    data: await aiService.getConversation(userId(req), req.params.id as string),
  });
}

export async function createConversation(req: Request, res: Response): Promise<void> {
  const conversation = await aiService.createConversation(
    userId(req),
    req.body as { feature: AiFeature; title?: string },
  );
  res.status(201).json({ success: true, data: conversation });
}

export async function renameConversation(req: Request, res: Response): Promise<void> {
  await aiService.renameConversation(
    userId(req),
    req.params.id as string,
    (req.body as { title: string }).title,
  );
  res.json({ success: true, data: { message: 'Renamed' } });
}

export async function deleteConversation(req: Request, res: Response): Promise<void> {
  await aiService.deleteConversation(userId(req), req.params.id as string);
  res.json({ success: true, data: { message: 'Conversation deleted' } });
}

export async function sendMessage(req: Request, res: Response): Promise<void> {
  const result = await aiService.sendMessage(userId(req), req.body as SendMessageInput);
  res.json({ success: true, data: result });
}

/**
 * Server-sent events stream for the chat UI.
 *
 * SSE rather than WebSockets: the flow is one-directional and short-lived, so
 * it needs no socket lifecycle, and it survives proxies that mishandle
 * upgrades.
 */
export async function streamMessage(req: Request, res: Response): Promise<void> {
  const owner = userId(req);
  const input = req.body as SendMessageInput;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Prevents nginx from buffering the stream into a single response.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Lets the generator abandon generation when the client goes away.
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    for await (const chunk of aiService.streamMessage(owner, {
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      feature: input.feature,
      content: input.content,
      signal: controller.signal,
    })) {
      send(chunk.type, chunk.data);
    }
  } catch (error) {
    send('error', {
      message: error instanceof Error ? error.message : 'Generation failed',
    });
  } finally {
    res.end();
  }
}

// --- Structured features ----------------------------------------------------

export async function generateExam(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await aiService.generateExam(req.body as GenerateExamInput) });
}

export async function explainConcept(req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    data: await aiService.explainConcept(req.body as ExplainConceptInput),
  });
}

export async function learningPath(req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    data: await aiService.generateLearningPath(req.body as LearningPathInput),
  });
}

export async function revisionSheet(req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    data: await aiService.generateRevisionSheet(req.body as RevisionSheetInput),
  });
}

export async function coach(req: Request, res: Response): Promise<void> {
  const input = req.body as CoachInput;
  const owner = userId(req);

  let stats: { streak: number; studyMinutesWeek: number; overdue: number } | undefined;

  if (input.includeStats) {
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - 6);

    const [user, sessions, overdue] = await Promise.all([
      prisma.user.findUnique({ where: { id: owner }, select: { currentStreak: true } }),
      prisma.studySession.aggregate({
        where: { userId: owner, startedAt: { gte: weekStart } },
        _sum: { durationSeconds: true },
      }),
      prisma.assignment.count({
        where: {
          userId: owner,
          deletedAt: null,
          dueAt: { lt: new Date() },
          status: { notIn: ['COMPLETED', 'SUBMITTED', 'ARCHIVED'] },
        },
      }),
    ]);

    stats = {
      streak: user?.currentStreak ?? 0,
      studyMinutesWeek: Math.round((sessions._sum.durationSeconds ?? 0) / 60),
      overdue,
    };
  }

  res.json({
    success: true,
    data: await aiService.coach({
      situation: input.situation,
      ...(stats ? { stats } : {}),
    }),
  });
}

export async function generateQuiz(req: Request, res: Response): Promise<void> {
  const { source, count } = req.body as { source: string; count: number };
  res.json({ success: true, data: await aiStudyService.generateQuiz({ source, count }) });
}

export async function summarise(req: Request, res: Response): Promise<void> {
  const { source } = req.body as { source: string };
  res.json({ success: true, data: await aiStudyService.summariseNote(source) });
}
