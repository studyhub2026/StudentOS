import 'server-only';
import type { AiMemory } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { logger } from '@/server/lib/logger';
import { geminiService } from './gemini.service';

/** Recall is bounded so the prompt stays lean. */
const MAX_RECALLED = 60;

/**
 * Formats what the AI knows about a student into a system-prompt block. Empty
 * when there is nothing remembered yet, so the plain chat prompt is unchanged.
 */
export async function getMemoryContext(userId: string): Promise<string> {
  const memories = await prisma.aiMemory.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: MAX_RECALLED,
  });
  if (memories.length === 0) return '';

  const lines = memories.map((m) => `- ${m.key.replace(/_/g, ' ')}: ${m.value}`);
  return (
    `What you remember about this student (use it naturally to personalise your help; ` +
    `do not recite it back verbatim):\n${lines.join('\n')}`
  );
}

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
          category: {
            type: 'string',
            enum: ['profile', 'study', 'goals', 'exams', 'habits', 'general'],
          },
        },
        required: ['key', 'value', 'category'],
      },
    },
  },
  required: ['facts'],
} as const;

const factsSchema = z.object({
  facts: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(60),
        value: z.string().trim().min(1).max(400),
        category: z.string().trim().min(1).max(30),
      }),
    )
    .max(12),
});

function normaliseKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/**
 * Extracts durable, personal facts from a chat turn and upserts them. Runs
 * best-effort in the background (via the route's `after`), so a failure or a
 * rate limit never affects the reply the student already received.
 */
export async function extractAndStore(
  userId: string,
  userMessage: string,
  assistantReply: string,
): Promise<void> {
  try {
    const result = await geminiService.generateJson({
      systemInstruction:
        'You maintain a long-term memory of a student. Extract only DURABLE, personal facts ' +
        'worth remembering across sessions: name, university, degree, semester, subjects, ' +
        'weak/strong topics, exam dates, goals, study habits, preferred language or explanation ' +
        'style. Ignore transient questions, greetings, and the assistant’s own content. ' +
        'Use short snake_case keys (e.g. name, university, current_subject, weak_subject, ' +
        'exam_date_calculus). Return an empty list if nothing durable was stated. Never invent facts.',
      messages: [
        {
          role: 'user',
          content: `Student said:\n${userMessage}\n\nAssistant replied:\n${assistantReply}\n\nExtract durable facts about the student.`,
        },
      ],
      responseSchema: EXTRACT_SCHEMA as unknown as Record<string, unknown>,
      parse: (value) => factsSchema.parse(value),
    });

    for (const fact of result.data.facts) {
      const key = normaliseKey(fact.key);
      if (!key) continue;
      await prisma.aiMemory.upsert({
        where: { userId_key: { userId, key } },
        create: { userId, key, value: fact.value, category: fact.category },
        update: { value: fact.value, category: fact.category },
      });
    }
  } catch (error) {
    logger.warn({ err: error, userId }, 'ai memory extraction failed');
  }
}

export function listMemories(userId: string): Promise<AiMemory[]> {
  return prisma.aiMemory.findMany({
    where: { userId },
    orderBy: [{ category: 'asc' }, { updatedAt: 'desc' }],
  });
}

export async function deleteMemory(userId: string, id: string): Promise<void> {
  await prisma.aiMemory.deleteMany({ where: { id, userId } });
}

export async function clearMemories(userId: string): Promise<number> {
  const { count } = await prisma.aiMemory.deleteMany({ where: { userId } });
  return count;
}

export const aiMemoryService = {
  getMemoryContext,
  extractAndStore,
  listMemories,
  deleteMemory,
  clearMemories,
};
