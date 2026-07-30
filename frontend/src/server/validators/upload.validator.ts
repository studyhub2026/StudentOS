import 'server-only';
import { z } from 'zod';

const cuid = z.string().min(1);

const FOLDERS = ['avatars', 'assignments', 'notes', 'messages'] as const;

export const signUploadSchema = z.object({
  folder: z.enum(FOLDERS),
});

export const registerUploadSchema = z
  .object({
    folder: z.enum(FOLDERS),
    publicId: z.string().min(1).max(300),
    url: z.string().url().max(1000),
    filename: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(120),
    sizeBytes: z.coerce.number().int().min(1).max(50 * 1024 * 1024),
    format: z.string().trim().max(20).optional(),
    width: z.coerce.number().int().positive().optional(),
    height: z.coerce.number().int().positive().optional(),

    assignmentId: cuid.optional(),
    noteId: cuid.optional(),
    messageId: cuid.optional(),
  })
  .refine(
    (value) =>
      // An attachment may belong to at most one parent; more than one would
      // make ownership and cascade behaviour ambiguous.
      [value.assignmentId, value.noteId, value.messageId].filter(Boolean).length <= 1,
    'An upload can be attached to only one item',
  );

export const fileIdSchema = z.object({ id: cuid });

export type SignUploadInput = z.infer<typeof signUploadSchema>;
export type RegisterUploadInput = z.infer<typeof registerUploadSchema>;
