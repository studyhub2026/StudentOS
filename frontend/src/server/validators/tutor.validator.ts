import 'server-only';
import { z } from 'zod';

const cuid = z.string().min(1);

export const DIFFICULTIES = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ADAPTIVE'] as const;

/** Create/activate a tutor. A catalogue subject supplies `subjectKey`; a custom
 *  subject supplies `subject` and we derive the key. */
export const createTutorSchema = z
  .object({
    subjectKey: z.string().trim().min(1).max(60).optional(),
    subject: z.string().trim().min(2).max(80).optional(),
    difficulty: z.enum(DIFFICULTIES).optional(),
  })
  .refine((v) => Boolean(v.subjectKey || v.subject), {
    message: 'Provide a subjectKey or a subject name',
    path: ['subject'],
  });

export const updateTutorSchema = z
  .object({
    difficulty: z.enum(DIFFICULTIES).optional(),
    explanationStyle: z.string().trim().max(400).nullish(),
    goals: z.string().trim().max(1000).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const createTutorConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export const renameTutorConversationSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120).optional(),
  pinned: z.boolean().optional(),
}).refine((v) => v.title !== undefined || v.pinned !== undefined, {
  message: 'Nothing to update',
});

export const tutorChatSchema = z.object({
  conversationId: cuid.optional(),
  content: z.string().trim().min(1, 'Message cannot be empty').max(20_000),
  tier: z.enum(['flash', 'pro']).optional(),
  /** Files already uploaded to the conversation to reference in this turn. */
  fileIds: z.array(cuid).max(20).optional(),
  /** Override the tutor's difficulty for this turn only (e.g. quick toggle). */
  difficulty: z.enum(DIFFICULTIES).optional(),
});

export const updateTutorMessageSchema = z
  .object({
    pinned: z.boolean().optional(),
    content: z.string().trim().min(1).max(20_000).optional(),
  })
  .refine((v) => v.pinned !== undefined || v.content !== undefined, {
    message: 'Nothing to update',
  });

export const tutorQuizSchema = z.object({
  conversationId: cuid.optional(),
  topic: z.string().trim().min(1).max(200).optional(),
  count: z.coerce.number().int().min(1).max(20).default(6),
});

export const tutorQuizSubmitSchema = z.object({
  topic: z.string().trim().max(200).optional(),
  total: z.coerce.number().int().min(1).max(50),
  correct: z.coerce.number().int().min(0).max(50),
  /** Topics the student got wrong, to reinforce. */
  missedTopics: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
}).refine((v) => v.correct <= v.total, {
  message: 'correct cannot exceed total',
  path: ['correct'],
});

export const tutorFlashcardSchema = z.object({
  conversationId: cuid.optional(),
  topic: z.string().trim().min(1).max(200).optional(),
  count: z.coerce.number().int().min(1).max(20).default(8),
});

export const registerTutorFileSchema = z.object({
  conversationId: cuid,
  filename: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().min(1).max(200),
  size: z.coerce.number().int().min(1).max(25 * 1024 * 1024),
  url: z.string().url(),
  storageKey: z.string().trim().min(1).max(400).optional(),
});

export const listTutorFilesSchema = z.object({ conversationId: cuid });

export type CreateTutorInput = z.infer<typeof createTutorSchema>;
export type UpdateTutorInput = z.infer<typeof updateTutorSchema>;
export type TutorChatInput = z.infer<typeof tutorChatSchema>;
export type TutorQuizInput = z.infer<typeof tutorQuizSchema>;
export type TutorQuizSubmitInput = z.infer<typeof tutorQuizSubmitSchema>;
export type TutorFlashcardInput = z.infer<typeof tutorFlashcardSchema>;
