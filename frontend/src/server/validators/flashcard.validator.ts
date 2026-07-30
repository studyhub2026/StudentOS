import 'server-only';
import { z } from 'zod';

const cuid = z.string().min(1);
const DIFFICULTY = ['EASY', 'MEDIUM', 'HARD'] as const;
const CARD_STATE = ['NEW', 'LEARNING', 'REVIEW', 'RELEARNING'] as const;

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.enum(values))])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const list = Array.isArray(value) ? value : value.split(',');
      return list.map((entry) => entry.trim()).filter(Boolean);
    })
    .pipe(z.array(z.enum(values)).optional());

export const createDeckSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a hex value like #14b8a6')
    .default('#14b8a6'),
  subjectId: cuid.optional().nullable(),
  sourceNoteId: cuid.optional().nullable(),
  isPublic: z.boolean().optional(),
  generatedByAi: z.boolean().optional(),
});

export const updateDeckSchema = createDeckSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const createCardSchema = z.object({
  front: z.string().trim().min(1, 'Front is required').max(4000),
  back: z.string().trim().min(1, 'Back is required').max(4000),
  hint: z.string().trim().max(1000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  difficulty: z.enum(DIFFICULTY).default('MEDIUM'),
  generatedByAi: z.boolean().optional(),
});

export const updateCardSchema = z
  .object({
    front: z.string().trim().min(1).max(4000).optional(),
    back: z.string().trim().min(1).max(4000).optional(),
    hint: z.string().trim().max(1000).optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    difficulty: z.enum(DIFFICULTY).optional(),
    suspended: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const bulkCreateCardsSchema = z.object({
  cards: z.array(createCardSchema).min(1, 'Provide at least one card').max(500),
});

export const listCardsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sortBy: z.enum(['createdAt', 'dueAt', 'front', 'intervalDays', 'lapses']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),

  difficulty: csv(DIFFICULTY),
  state: csv(CARD_STATE),
  suspended: z.coerce.boolean().optional(),
  search: z.string().trim().max(200).optional(),
  tags: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const list = Array.isArray(value) ? value : value.split(',');
      return list.map((entry) => entry.trim()).filter(Boolean);
    }),
});

export const reviewQueueSchema = z.object({
  deckId: cuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Caps how many unseen cards enter one session, to avoid overload. */
  newLimit: z.coerce.number().int().min(0).max(100).default(20),
});

export const reviewCardSchema = z.object({
  rating: z.enum(['again', 'hard', 'good', 'easy']),
  responseMs: z.number().int().min(0).max(600_000).optional(),
});

export const statsQuerySchema = z.object({
  deckId: cuid.optional(),
  heatmapDays: z.coerce.number().int().min(7).max(365).default(120),
  forecastDays: z.coerce.number().int().min(1).max(90).default(30),
});

export const generateCardsSchema = z.object({
  /** Source text to generate from — a note body, a topic, or pasted material. */
  source: z.string().trim().min(20, 'Provide at least a sentence of source material').max(50_000),
  count: z.coerce.number().int().min(1).max(50).default(10),
  difficulty: z.enum(DIFFICULTY).default('MEDIUM'),
  /** Persist directly into the deck instead of returning a preview. */
  save: z.boolean().default(false),
  noteId: cuid.optional(),
});

export const importDeckSchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
  /** Raw file contents. Parsed server-side according to `format`. */
  data: z.string().min(1, 'Nothing to import').max(5_000_000),
  deckName: z.string().trim().min(1).max(120).optional(),
});

export const deckIdSchema = z.object({ id: cuid });
export const cardIdSchema = z.object({ cardId: cuid });
export const deckCardParamsSchema = z.object({ id: cuid, cardId: cuid });

export type CreateDeckInput = z.infer<typeof createDeckSchema>;
export type UpdateDeckInput = z.infer<typeof updateDeckSchema>;
export type CreateCardInput = z.infer<typeof createCardSchema>;
export type UpdateCardInput = z.infer<typeof updateCardSchema>;
export type ListCardsQuery = z.infer<typeof listCardsSchema>;
export type GenerateCardsInput = z.infer<typeof generateCardsSchema>;
export type ImportDeckInput = z.infer<typeof importDeckSchema>;
