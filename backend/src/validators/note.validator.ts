import { z } from 'zod';

const cuid = z.string().min(1);

const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(30);

export const createNoteSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  content: z.string().max(500_000, 'Note is too large').optional(),
  /** Editor AST. Markdown in `content` remains the source of record. */
  contentJson: z.unknown().optional(),
  tags: tagsSchema.optional(),
  folderId: cuid.optional().nullable(),
  subjectId: cuid.optional().nullable(),
  pinned: z.boolean().optional(),
  favorite: z.boolean().optional(),
});

export const updateNoteSchema = createNoteSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

/** Autosave sends only the body; everything else is ignored. */
export const autosaveNoteSchema = z.object({
  content: z.string().max(500_000),
  contentJson: z.unknown().optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

export const listNotesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['updatedAt', 'createdAt', 'title', 'wordCount']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),

  view: z.enum(['active', 'favorites', 'archived', 'trash']).default('active'),
  folderId: cuid.optional(),
  subjectId: cuid.optional(),
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

export const noteIdSchema = z.object({ id: cuid });
export const noteVersionParamsSchema = z.object({ id: cuid, versionId: cuid });

export const createFolderSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a hex value like #8b5cf6')
    .optional()
    .nullable(),
  parentId: cuid.optional().nullable(),
});

export const updateFolderSchema = createFolderSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const shareNoteSchema = z
  .object({
    sharedWithId: cuid.optional().nullable(),
    permission: z.enum(['VIEW', 'COMMENT', 'EDIT']).default('VIEW'),
    createLink: z.boolean().optional(),
  })
  .refine(
    (value) => Boolean(value.sharedWithId) || value.createLink === true,
    'Specify a user to share with, or request a share link',
  );

export const shareIdSchema = z.object({ id: cuid, shareId: cuid });
export const linkTokenSchema = z.object({ token: z.string().min(1) });

export const favoriteSchema = z.object({ favorite: z.boolean() });
export const archiveSchema = z.object({ archived: z.boolean() });

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
export type ListNotesQuery = z.infer<typeof listNotesSchema>;
export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
export type ShareNoteInput = z.infer<typeof shareNoteSchema>;
