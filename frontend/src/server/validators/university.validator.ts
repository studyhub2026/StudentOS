import 'server-only';
import { z } from 'zod';

const LMS_PROVIDERS = [
  'MOODLE',
  'BLACKBOARD',
  'CANVAS',
  'BRIGHTSPACE',
  'SAKAI',
  'GOOGLE_CLASSROOM',
  'MS_TEAMS',
] as const;

const cuid = z.string().min(1);

/**
 * Sync intervals presented in the UI. 5 min up to weekly (10080 min = 7×24×60).
 * The Advanced Scheduler dropdown in /university uses this same list to render
 * options — kept as a shared constant so the client can't submit a value the
 * server won't accept.
 */
export const SYNC_INTERVAL_MINUTES = [5, 15, 30, 60, 360, 720, 1440, 10080] as const;
export type SyncIntervalMinutes = (typeof SYNC_INTERVAL_MINUTES)[number];

const syncIntervalSchema = z.coerce
  .number()
  .int()
  .refine(
    (v) => (SYNC_INTERVAL_MINUTES as readonly number[]).includes(v),
    `syncInterval must be one of ${SYNC_INTERVAL_MINUTES.join(', ')}`,
  )
  .default(60);

export const createConnectionSchema = z.object({
  provider: z.enum(LMS_PROVIDERS),
  displayName: z.string().trim().min(1, 'Display name is required').max(120),
  portalUrl: z.string().trim().url('Portal URL must be a valid URL'),
  apiKey: z.string().trim().max(2000).optional(),
  accessToken: z.string().trim().max(4000).optional(),
  refreshToken: z.string().trim().max(4000).optional(),
  autoSync: z.boolean().default(true),
  syncInterval: syncIntervalSchema,
  importGrades: z.boolean().default(true),
  importCalendar: z.boolean().default(true),
  importFiles: z.boolean().default(true),
});

export const updateConnectionSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    portalUrl: z.string().trim().url().optional(),
    apiKey: z.string().trim().max(2000).optional().nullable(),
    accessToken: z.string().trim().max(4000).optional().nullable(),
    refreshToken: z.string().trim().max(4000).optional().nullable(),
    autoSync: z.boolean().optional(),
    syncInterval: z
      .coerce
      .number()
      .int()
      .refine(
        (v) => (SYNC_INTERVAL_MINUTES as readonly number[]).includes(v),
        `syncInterval must be one of ${SYNC_INTERVAL_MINUTES.join(', ')}`,
      )
      .optional(),
    importGrades: z.boolean().optional(),
    importCalendar: z.boolean().optional(),
    importFiles: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const connectionIdSchema = z.object({ id: cuid });

export const listSyncLogsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  connectionId: cuid.optional(),
});

export const importFileSchema = z.object({
  connectionId: cuid,
  format: z.enum(['ics', 'csv', 'xlsx']),
});

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;
export type ListSyncLogsQuery = z.infer<typeof listSyncLogsSchema>;
