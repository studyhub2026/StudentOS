import 'server-only';
import { z } from 'zod';

const cuid = z.string().min(1);

const AI_FEATURE = [
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
] as const;

export const listConversationsSchema = z.object({
  feature: z.enum(AI_FEATURE).optional(),
  archived: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export const createConversationSchema = z.object({
  feature: z.enum(AI_FEATURE).default('CHAT'),
  title: z.string().trim().min(1).max(120).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const sendMessageSchema = z
  .object({
    conversationId: cuid.optional(),
    feature: z.enum(AI_FEATURE).default('CHAT'),
    // Empty when regenerating an existing reply — the prior user turn is reused.
    content: z.string().trim().max(20_000).default(''),
    /** "pro" routes to the higher-tier model on the chosen provider. */
    tier: z.enum(['flash', 'pro']).optional(),
    /** Files already uploaded to the conversation to reference in this turn. */
    fileIds: z.array(cuid).max(20).optional(),
    /** Explicit academic context the user attached via the context selector. */
    contextRefs: z
      .array(
        z.object({
          type: z.enum(['note', 'subject', 'document']),
          id: cuid,
        }),
      )
      .max(10)
      .optional(),
    /** Regenerate this existing assistant reply instead of sending new content. */
    regenerateMessageId: cuid.optional(),
  })
  .refine((v) => v.content.length > 0 || !!v.regenerateMessageId, {
    message: 'Message cannot be empty',
    path: ['content'],
  })
  .refine((v) => !v.regenerateMessageId || !!v.conversationId, {
    message: 'conversationId is required to regenerate a reply',
    path: ['conversationId'],
  });

export const renameConversationSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120),
});

export const updateConversationSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(120).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => v.title !== undefined || v.pinned !== undefined || v.archived !== undefined, {
    message: 'Nothing to update',
  });

export const conversationIdSchema = z.object({ id: cuid });

// --- Structured features ----------------------------------------------------

const sourceText = z
  .string()
  .trim()
  .min(20, 'Provide at least a sentence of source material')
  .max(50_000);

export const generateExamSchema = z.object({
  source: sourceText,
  questionCount: z.coerce.number().int().min(1).max(30).default(8),
  durationMinutes: z.coerce.number().int().min(10).max(300).default(60),
  level: z.string().trim().min(1).max(60).default('undergraduate'),
  subject: z.string().trim().min(1).max(80).default('general'),
});

export const explainConceptSchema = z.object({
  concept: z.string().trim().min(2, 'Name the concept').max(200),
  level: z.string().trim().min(1).max(60).default('undergraduate'),
  context: z.string().trim().max(20_000).optional(),
});

export const learningPathSchema = z.object({
  goal: z.string().trim().min(5, 'Describe the goal').max(300),
  currentLevel: z.string().trim().min(1).max(60).default('beginner'),
  hoursPerWeek: z.coerce.number().int().min(1).max(80).default(5),
});

export const revisionSheetSchema = z.object({
  source: sourceText,
  topic: z.string().trim().min(1, 'Name the topic').max(200),
});

export const coachSchema = z.object({
  situation: z.string().trim().min(5, 'Tell the coach what is going on').max(4000),
  /** Opt in to sharing recent activity so advice can reference it. */
  includeStats: z.boolean().default(true),
});

export const quizSchema = z.object({
  source: sourceText,
  count: z.coerce.number().int().min(1).max(30).default(10),
});

export const summariseSchema = z.object({
  source: sourceText,
});

// --- File uploads -----------------------------------------------------------

export const registerAiFileSchema = z.object({
  conversationId: cuid,
  filename: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().min(1).max(200),
  size: z.coerce.number().int().min(1).max(25 * 1024 * 1024),
  url: z.string().url(),
  storageKey: z.string().trim().min(1).max(400).optional(),
});

export const listAiFilesSchema = z.object({
  conversationId: cuid,
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type GenerateExamInput = z.infer<typeof generateExamSchema>;
export type ExplainConceptInput = z.infer<typeof explainConceptSchema>;
export type LearningPathInput = z.infer<typeof learningPathSchema>;
export type RevisionSheetInput = z.infer<typeof revisionSheetSchema>;
export type CoachInput = z.infer<typeof coachSchema>;
