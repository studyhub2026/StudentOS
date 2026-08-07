import 'server-only';
import { createHash } from 'crypto';
import type { LmsProvider, Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { BadRequestError, ConflictError, NotFoundError } from '@/server/lib/errors';
import { encrypt, decrypt } from '@/server/lib/crypto';
import { env } from '@/server/env';
import { logger } from '@/server/lib/logger';
import { extractText, resolveType } from './file-extract.service';
import { generateFromPrompt } from './gemini.service';
import {
  getAdapter,
  getMeta,
  hasCapability,
  isProviderReady,
  SyncMetrics,
  type Capability,
} from './lms';
import type {
  ExternalAnnouncement,
  ExternalAssignment,
  ExternalCalendarEvent,
  ExternalCourse,
  ExternalExam,
  ExternalFile,
  ExternalGrade,
  LmsAdapter,
  LmsTokens,
} from './lms';
import { LmsProviderError } from './lms';
import {
  emptySyncPlan,
  estimatePlanCost,
  pushSample,
  type EntityPlan,
  type SyncPlan,
} from './lms/plan';
import type {
  CreateConnectionInput,
  UpdateConnectionInput,
  ListSyncLogsQuery,
} from '@/server/validators/university.validator';
import {
  enqueueManualSync,
  getQueueCounts,
  scheduleAutoSync,
  unscheduleAutoSync,
} from '@/server/queue/lms-sync.queue';

// ---------------------------------------------------------------------------
// Connection CRUD (backward compatible with the Phase 1/2 API).
// ---------------------------------------------------------------------------

const connectionSelect = {
  id: true,
  userId: true,
  provider: true,
  displayName: true,
  portalUrl: true,
  status: true,
  statusDetail: true,
  autoSync: true,
  syncInterval: true,
  importGrades: true,
  importCalendar: true,
  importFiles: true,
  lastSyncAt: true,
  createdAt: true,
  updatedAt: true,
  tokenExpiresAt: true,
  profileData: true,
  remoteUserId: true,
  adapterVersion: true,
  _count: {
    select: {
      courses: true,
      assignments: true,
      exams: true,
      announcements: true,
      grades: true,
      files: true,
      conflicts: true,
    },
  },
} satisfies Prisma.LmsConnectionSelect;

export type ConnectionWithCounts = Prisma.LmsConnectionGetPayload<{
  select: typeof connectionSelect;
}>;

async function listConnections(userId: string): Promise<ConnectionWithCounts[]> {
  return prisma.lmsConnection.findMany({
    where: { userId },
    select: connectionSelect,
    orderBy: { createdAt: 'desc' },
  });
}

async function getConnection(userId: string, id: string): Promise<ConnectionWithCounts> {
  const conn = await prisma.lmsConnection.findUnique({
    where: { id },
    select: connectionSelect,
  });
  if (!conn || conn.userId !== userId) throw new NotFoundError('Connection');
  return conn;
}

async function createConnection(
  userId: string,
  input: CreateConnectionInput,
): Promise<ConnectionWithCounts> {
  const existing = await prisma.lmsConnection.findUnique({
    where: {
      userId_provider_portalUrl: {
        userId,
        provider: input.provider,
        portalUrl: input.portalUrl,
      },
    },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError('A connection for this LMS and portal already exists');
  }

  const primaryToken = input.accessToken ?? input.apiKey;
  if (primaryToken) {
    await validateProviderCredential(input.provider, input.portalUrl, primaryToken);
  }

  // Snapshot the registry's adapter version so future upgrades can decide
  // whether this connection needs a re-auth.
  const adapterVersion = getMeta(input.provider).adapterVersion;

  const created = await prisma.lmsConnection.create({
    data: {
      userId,
      provider: input.provider,
      displayName: input.displayName,
      portalUrl: input.portalUrl,
      encryptedAccessToken: primaryToken ? encrypt(primaryToken) : null,
      encryptedRefreshToken: input.refreshToken ? encrypt(input.refreshToken) : null,
      encryptedApiKey: null,
      status: primaryToken ? 'CONNECTED' : 'DISCONNECTED',
      autoSync: input.autoSync,
      syncInterval: input.syncInterval,
      importGrades: input.importGrades,
      importCalendar: input.importCalendar,
      importFiles: input.importFiles,
      adapterVersion,
    },
    select: connectionSelect,
  });

  await registerScheduler(created);
  return created;
}

async function validateProviderCredential(
  provider: LmsProvider,
  portalUrl: string,
  token: string,
): Promise<void> {
  if (!isProviderReady(provider)) return;
  try {
    const adapter = getAdapter(provider, portalUrl);
    await adapter.getProfile({ accessToken: token });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BadRequestError(`Could not verify credentials with ${provider}: ${msg}`);
  }
}

async function updateConnection(
  userId: string,
  id: string,
  input: UpdateConnectionInput,
): Promise<ConnectionWithCounts> {
  const conn = await prisma.lmsConnection.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!conn || conn.userId !== userId) throw new NotFoundError('Connection');

  const data: Prisma.LmsConnectionUpdateInput = {};

  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.portalUrl !== undefined) data.portalUrl = input.portalUrl;
  if (input.autoSync !== undefined) data.autoSync = input.autoSync;
  if (input.syncInterval !== undefined) data.syncInterval = input.syncInterval;
  if (input.importGrades !== undefined) data.importGrades = input.importGrades;
  if (input.importCalendar !== undefined) data.importCalendar = input.importCalendar;
  if (input.importFiles !== undefined) data.importFiles = input.importFiles;

  const newToken = input.accessToken !== undefined ? input.accessToken : input.apiKey;
  if (newToken !== undefined) {
    if (newToken) {
      const c = await prisma.lmsConnection.findUnique({
        where: { id },
        select: { provider: true, portalUrl: true },
      });
      if (c) {
        await validateProviderCredential(c.provider, input.portalUrl ?? c.portalUrl, newToken);
      }
    }
    data.encryptedAccessToken = newToken ? encrypt(newToken) : null;
    data.encryptedApiKey = null;
    data.status = newToken ? 'CONNECTED' : 'DISCONNECTED';
  }

  if (input.refreshToken !== undefined) {
    data.encryptedRefreshToken = input.refreshToken ? encrypt(input.refreshToken) : null;
  }

  const updated = await prisma.lmsConnection.update({
    where: { id },
    data,
    select: connectionSelect,
  });

  await registerScheduler(updated);
  return updated;
}

async function deleteConnection(userId: string, id: string): Promise<void> {
  const conn = await prisma.lmsConnection.findUnique({
    where: { id },
    select: {
      userId: true,
      provider: true,
      portalUrl: true,
      encryptedAccessToken: true,
      encryptedRefreshToken: true,
    },
  });
  if (!conn || conn.userId !== userId) throw new NotFoundError('Connection');

  if (isProviderReady(conn.provider) && conn.encryptedAccessToken) {
    try {
      const adapter = getAdapter(conn.provider, conn.portalUrl);
      await adapter.revoke({
        accessToken: decrypt(conn.encryptedAccessToken),
        refreshToken: conn.encryptedRefreshToken ? decrypt(conn.encryptedRefreshToken) : undefined,
      });
    } catch (err) {
      logger.warn({ err, connectionId: id }, 'lms: provider revoke failed (proceeding with delete)');
    }
  }

  if (env.hasRedis) {
    try {
      await unscheduleAutoSync(id);
    } catch (err) {
      logger.warn({ err, connectionId: id }, 'lms: unscheduleAutoSync failed');
    }
  }

  await prisma.lmsConnection.delete({ where: { id } });
}

async function registerScheduler(conn: ConnectionWithCounts): Promise<void> {
  if (!env.hasRedis) return;
  try {
    if (conn.autoSync && conn.status !== 'DISCONNECTED') {
      await scheduleAutoSync(conn.id, conn.userId, conn.syncInterval);
    } else {
      await unscheduleAutoSync(conn.id);
    }
  } catch (err) {
    logger.warn({ err, connectionId: conn.id }, 'lms: registerScheduler failed');
  }
}

// ---------------------------------------------------------------------------
// Dashboard + sync-log queries.
// ---------------------------------------------------------------------------

interface DashboardStats {
  connections: number;
  courses: number;
  assignments: number;
  exams: number;
  announcements: number;
  grades: number;
  files: number;
  lastSyncAt: string | null;
  syncErrors: number;
  pendingConflicts: number;
  pendingPreviews: number;
  queue?: {
    active: number;
    waiting: number;
    completed: number;
    failed: number;
    delayed: number;
  };
}

async function getDashboard(userId: string): Promise<DashboardStats> {
  const [
    connections,
    courses,
    assignments,
    exams,
    announcements,
    grades,
    files,
    errorLogs,
    pendingConflicts,
    pendingPreviews,
  ] = await Promise.all([
    prisma.lmsConnection.count({ where: { userId } }),
    prisma.lmsCourse.count({ where: { userId } }),
    prisma.lmsAssignment.count({ where: { userId } }),
    prisma.lmsExam.count({ where: { userId } }),
    prisma.lmsAnnouncement.count({ where: { userId } }),
    prisma.lmsGrade.count({ where: { userId } }),
    prisma.lmsFile.count({ where: { userId } }),
    prisma.syncLog.count({ where: { userId, status: 'FAILED' } }),
    prisma.lmsConflict.count({ where: { userId, status: 'PENDING' } }),
    prisma.lmsSyncPreview.count({
      where: { userId, status: 'PENDING', expiresAt: { gt: new Date() } },
    }),
  ]);

  const lastSync = await prisma.lmsConnection.findFirst({
    where: { userId, lastSyncAt: { not: null } },
    orderBy: { lastSyncAt: 'desc' },
    select: { lastSyncAt: true },
  });

  let queue: DashboardStats['queue'];
  if (env.hasRedis) {
    try {
      queue = await getQueueCounts();
    } catch (err) {
      logger.warn({ err }, 'lms: queue counts failed');
    }
  }

  return {
    connections,
    courses,
    assignments,
    exams,
    announcements,
    grades,
    files,
    lastSyncAt: lastSync?.lastSyncAt?.toISOString() ?? null,
    syncErrors: errorLogs,
    pendingConflicts,
    pendingPreviews,
    queue,
  };
}

async function listSyncLogs(userId: string, query: ListSyncLogsQuery) {
  const where: Prisma.SyncLogWhereInput = { userId };
  if (query.connectionId) where.connectionId = query.connectionId;

  const [items, total] = await Promise.all([
    prisma.syncLog.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: { connection: { select: { displayName: true, provider: true } } },
    }),
    prisma.syncLog.count({ where }),
  ]);

  const totalPages = Math.ceil(total / query.limit);
  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNext: query.page < totalPages,
      hasPrevious: query.page > 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Sync orchestration
// ---------------------------------------------------------------------------

export interface RunSyncOptions {
  scheduled: boolean;
  attempt: number;
  /** When true, the engine walks the remote data but never mutates the DB. */
  dryRun?: boolean;
  /** BullMQ timestamps used to compute queue wait/execution metrics. */
  queuedAt?: number;
  startedAt?: number;
}

export interface RunSyncResult {
  syncLogId: string;
  /** Populated in dry-run mode. Empty plan otherwise. */
  plan?: SyncPlan;
  estimates?: ReturnType<typeof estimatePlanCost>;
}

interface SyncLogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
}

async function triggerSync(
  userId: string,
  connectionId: string,
): Promise<{ jobId?: string; syncLogId?: string }> {
  const conn = await prisma.lmsConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, userId: true, status: true },
  });
  if (!conn || conn.userId !== userId) throw new NotFoundError('Connection');
  if (conn.status === 'SYNCING') {
    throw new BadRequestError('A sync is already in progress for this connection');
  }

  if (env.hasRedis) {
    const jobId = await enqueueManualSync(connectionId, userId);
    logger.info({ jobId, connectionId }, 'lms: manual sync enqueued');
    return { jobId };
  }

  logger.warn({ connectionId }, 'lms: Redis not configured — running sync inline');
  const result = await runSyncJob(userId, connectionId, { scheduled: false, attempt: 1 });
  return { syncLogId: result.syncLogId };
}

export async function runSyncJob(
  userId: string,
  connectionId: string,
  options: RunSyncOptions,
): Promise<RunSyncResult> {
  const conn = await prisma.lmsConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      userId: true,
      provider: true,
      portalUrl: true,
      status: true,
      encryptedAccessToken: true,
      encryptedRefreshToken: true,
      encryptedApiKey: true,
      tokenExpiresAt: true,
      lastSyncAt: true,
      importGrades: true,
      importCalendar: true,
      importFiles: true,
    },
  });
  if (!conn || conn.userId !== userId) throw new NotFoundError('Connection');

  const syncLog = await prisma.syncLog.create({
    data: { connectionId, userId, status: 'RUNNING', dryRun: options.dryRun ?? false },
  });
  if (!options.dryRun) {
    await prisma.lmsConnection.update({
      where: { id: connectionId },
      data: { status: 'SYNCING' },
    });
  }

  const logs: SyncLogEntry[] = [];
  const log = (level: SyncLogEntry['level'], message: string) => {
    logs.push({ level, message, timestamp: new Date().toISOString() });
  };

  const counts = zeroCounts();
  const metrics = new SyncMetrics();
  const plan = emptySyncPlan();
  const startedWall = Date.now();

  try {
    if (!isProviderReady(conn.provider)) {
      throw new Error(`Provider ${conn.provider} is not configured on this server`);
    }
    if (!conn.encryptedAccessToken) {
      throw new Error('This connection has no access token — reconnect required');
    }

    const adapter = getAdapter(conn.provider, conn.portalUrl, metrics);
    const tokens = await resolveTokens(conn, adapter);

    const since = conn.lastSyncAt
      ? new Date(conn.lastSyncAt.getTime() - 5 * 60_000)
      : undefined;

    // --- Profile (write-mode only — dry-run doesn't touch the connection). ---
    if (!options.dryRun) {
      try {
        const profile = await adapter.getProfile(tokens);
        await prisma.lmsConnection.update({
          where: { id: connectionId },
          data: {
            profileData: profile as unknown as Prisma.InputJsonValue,
            remoteUserId: profile.remoteUserId,
          },
        });
      } catch (err) {
        log('warn', `Could not fetch profile: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // --- Courses ---
    if (!hasCapability(conn.provider, 'COURSES')) {
      log('warn', 'Provider does not support courses — skipping entire sync');
      return finish('COMPLETED', undefined, options.dryRun ? plan : undefined);
    }
    log('info', `Fetching courses (since=${since?.toISOString() ?? 'never'})`);
    const extCourses = await adapter.getCourses(tokens, { since });
    counts.coursesFound = extCourses.length;

    for (const ec of extCourses) {
      if (options.dryRun) {
        await planCourse(connectionId, ec, plan.courses);
        continue;
      }
      const stats = await upsertCourse(connectionId, userId, ec);
      counts.coursesCreated += stats.created;
      counts.coursesUpdated += stats.updated;
    }

    const dbCourses = await prisma.lmsCourse.findMany({
      where: { connectionId },
      select: { id: true, externalId: true, name: true },
    });
    const courseMap = new Map(dbCourses.map((c) => [c.externalId, { id: c.id, name: c.name }]));

    // --- Assignments ---
    if (hasCapability(conn.provider, 'ASSIGNMENTS')) {
      for (const ec of extCourses) {
        const local = courseMap.get(ec.externalId);
        if (!local && !options.dryRun) continue;
        const items = await adapter.getAssignments(tokens, ec.externalId, { since });
        counts.assignmentsFound += items.length;
        for (const ea of items) {
          if (options.dryRun) {
            await planAssignment(connectionId, ea, plan.assignments, ec.name);
            continue;
          }
          const stats = await upsertAssignment(connectionId, userId, local!.id, ea, metrics);
          counts.assignmentsCreated += stats.created;
          counts.assignmentsUpdated += stats.updated;
          if (stats.conflict) metrics.incDuplicates();
          if (stats.created) {
            await notify(
              userId,
              'LMS_NEW_ASSIGNMENT',
              `New assignment: ${ea.title}`,
              formatDue(ea.dueAt),
              '/assignments',
            );
          }
        }
      }
    } else {
      log('info', 'Provider capability ASSIGNMENTS = false, skipping.');
    }

    // --- Exams / quizzes ---
    if (conn.importCalendar && hasCapability(conn.provider, 'QUIZZES')) {
      for (const ec of extCourses) {
        const local = courseMap.get(ec.externalId);
        if (!local && !options.dryRun) continue;
        const items = await adapter.getExams(tokens, ec.externalId, { since });
        counts.examsFound += items.length;
        for (const ee of items) {
          if (options.dryRun) {
            await planExam(connectionId, ee, plan.exams, ec.name);
            continue;
          }
          const stats = await upsertExam(connectionId, userId, local!.id, ee);
          counts.examsCreated += stats.created;
          counts.examsUpdated += stats.updated;
        }
      }
    }

    // --- Announcements ---
    if (hasCapability(conn.provider, 'ANNOUNCEMENTS')) {
      for (const ec of extCourses) {
        const local = courseMap.get(ec.externalId);
        if (!local && !options.dryRun) continue;
        const items = await adapter.getAnnouncements(tokens, ec.externalId, { since });
        counts.announcementsFound += items.length;
        for (const ea of items) {
          if (options.dryRun) {
            await planAnnouncement(connectionId, ea, plan.announcements, ec.name);
            continue;
          }
          const stats = await upsertAnnouncement(connectionId, userId, local!.id, ea);
          counts.announcementsCreated += stats.created;
          counts.announcementsUpdated += stats.updated;
          if (stats.created) {
            await notify(userId, 'LMS_ANNOUNCEMENT', ea.title, ea.body?.slice(0, 200), '/university');
          }
        }
      }
    }

    // --- Grades ---
    if (conn.importGrades && hasCapability(conn.provider, 'GRADES')) {
      for (const ec of extCourses) {
        const local = courseMap.get(ec.externalId);
        if (!local && !options.dryRun) continue;
        const items = await adapter.getGrades(tokens, ec.externalId);
        counts.gradesFound += items.length;
        for (const eg of items) {
          if (options.dryRun) {
            await planGrade(connectionId, eg, plan.grades, ec.name);
            continue;
          }
          const stats = await upsertGrade(connectionId, userId, local!.id, eg);
          counts.gradesCreated += stats.created;
          counts.gradesUpdated += stats.updated;
          if (stats.created) {
            await notify(
              userId,
              'LMS_NEW_GRADE',
              `New grade: ${eg.label}`,
              eg.score != null && eg.maxScore != null
                ? `${eg.score}/${eg.maxScore}`
                : (eg.letterGrade ?? 'Grade posted'),
              '/university',
            );
          }
        }
      }
    }

    // --- Files (routed through the shared Knowledge Base pipeline). ---
    const fileBytesForEstimate: number[] = [];
    if (conn.importFiles && hasCapability(conn.provider, 'FILES')) {
      for (const ec of extCourses) {
        const local = courseMap.get(ec.externalId);
        if (!local && !options.dryRun) continue;
        const items = await adapter.getFiles(tokens, ec.externalId, { since });
        counts.filesFound += items.length;
        for (const ef of items) {
          if (options.dryRun) {
            await planFile(connectionId, ef, plan.files, ec.name);
            if (ef.sizeBytes) fileBytesForEstimate.push(ef.sizeBytes);
            continue;
          }
          const stats = await upsertFile(
            connectionId,
            userId,
            local!.id,
            local!.name,
            ef,
            tokens,
          );
          counts.filesCreated += stats.created;
          counts.filesUpdated += stats.updated;
        }
      }
    }

    // --- Calendar events → ScheduleBlock (write-mode only, no planning). ---
    if (!options.dryRun && conn.importCalendar && hasCapability(conn.provider, 'CALENDAR')) {
      for (const ec of extCourses) {
        const local = courseMap.get(ec.externalId);
        if (!local) continue;
        try {
          const events = await adapter.getCalendar(tokens, ec.externalId, { since });
          for (const evt of events) {
            await upsertCalendarBlock(userId, local.id, evt);
          }
        } catch (err) {
          log(
            'warn',
            `Calendar fetch failed for ${ec.name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    log('info', options.dryRun ? 'Dry-run complete' : 'Sync complete');
    return finish('COMPLETED', undefined, options.dryRun ? plan : undefined, fileBytesForEstimate);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log('error', message);
    metrics.incFailed();
    return finish('FAILED', message);
  }

  async function finish(
    status: 'COMPLETED' | 'FAILED',
    errorMessage?: string,
    finalPlan?: SyncPlan,
    fileBytes?: number[],
  ): Promise<RunSyncResult> {
    const now = new Date();
    const wallMs = Date.now() - startedWall;
    const m = metrics.snapshot();

    // Queue timings when the worker supplied them; otherwise 0.
    const queueWaitMs =
      options.queuedAt && options.startedAt ? options.startedAt - options.queuedAt : 0;
    const queueExecutionMs =
      options.startedAt ? Date.now() - options.startedAt : wallMs;

    const estimates = finalPlan ? estimatePlanCost(finalPlan, fileBytes ?? []) : undefined;

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status,
        endedAt: now,
        logs: JSON.stringify(logs),
        errors: errorMessage,
        ...counts,
        ...m,
        queueWaitMs,
        queueExecutionMs,
        plan: finalPlan ? (finalPlan as unknown as Prisma.InputJsonValue) : undefined,
      },
    });

    if (!options.dryRun) {
      await prisma.lmsConnection.update({
        where: { id: connectionId },
        data:
          status === 'COMPLETED'
            ? { status: 'CONNECTED', lastSyncAt: now, statusDetail: null }
            : { status: 'ERROR', statusDetail: errorMessage?.slice(0, 500) ?? null },
      });

      const totalNew =
        counts.coursesCreated +
        counts.assignmentsCreated +
        counts.examsCreated +
        counts.announcementsCreated +
        counts.gradesCreated +
        counts.filesCreated;
      if (status === 'COMPLETED' && totalNew > 0) {
        await notify(
          userId,
          'LMS_SYNC_COMPLETE',
          'University sync complete',
          `Imported ${totalNew} new item${totalNew === 1 ? '' : 's'}`,
          '/university',
        );
      }

      await prisma.activityLog.create({
        data: {
          userId,
          action: status === 'COMPLETED' ? 'LMS_SYNC' : 'LMS_SYNC_FAILED',
          entityType: 'LmsConnection',
          entityId: connectionId,
          metadata: {
            status,
            scheduled: options.scheduled,
            attempt: options.attempt,
            durationMs: wallMs,
            ...counts,
            ...m,
          },
        },
      });
    }

    if (status === 'FAILED' && errorMessage) {
      throw new Error(errorMessage);
    }

    return { syncLogId: syncLog.id, plan: finalPlan, estimates };
  }
}

/**
 * Returns a live access token, refreshing if the stored one is expired. When
 * a refresh rotates the pair, persists the new values encrypted.
 */
async function resolveTokens(
  conn: {
    id: string;
    provider: LmsProvider;
    encryptedAccessToken: string | null;
    encryptedRefreshToken: string | null;
    tokenExpiresAt: Date | null;
  },
  adapter: LmsAdapter,
): Promise<LmsTokens> {
  if (!conn.encryptedAccessToken) {
    throw new Error('No access token stored for this connection');
  }
  const accessToken = decrypt(conn.encryptedAccessToken);
  const refreshToken = conn.encryptedRefreshToken ? decrypt(conn.encryptedRefreshToken) : undefined;

  const expiringSoon =
    conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() - Date.now() < 60_000;
  if (!expiringSoon || !refreshToken) {
    return { accessToken, refreshToken, expiresAt: conn.tokenExpiresAt ?? undefined };
  }

  logger.info({ connectionId: conn.id }, 'lms: refreshing access token');
  const result = await adapter.refresh(refreshToken);
  await prisma.lmsConnection.update({
    where: { id: conn.id },
    data: {
      encryptedAccessToken: encrypt(result.tokens.accessToken),
      encryptedRefreshToken: result.tokens.refreshToken
        ? encrypt(result.tokens.refreshToken)
        : conn.encryptedRefreshToken,
      tokenExpiresAt: result.tokens.expiresAt ?? null,
    },
  });
  return result.tokens;
}

// ---------------------------------------------------------------------------
// Upsert helpers with checksum-based change detection + conflict handling.
// ---------------------------------------------------------------------------

function computeChecksum(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

interface UpsertStats {
  created: number;
  updated: number;
  /** True when the write was diverted to an LmsConflict row (local edit + remote change). */
  conflict?: boolean;
}

async function upsertCourse(
  connectionId: string,
  userId: string,
  ec: ExternalCourse,
): Promise<UpsertStats> {
  const checksum = computeChecksum({
    name: ec.name,
    code: ec.code,
    instructor: ec.instructor,
    term: ec.term,
    active: ec.active,
  });
  const existing = await prisma.lmsCourse.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: ec.externalId } },
    select: { id: true, checksum: true },
  });
  if (!existing) {
    await prisma.lmsCourse.create({
      data: {
        connectionId,
        userId,
        externalId: ec.externalId,
        name: ec.name,
        code: ec.code,
        instructor: ec.instructor,
        term: ec.term,
        active: ec.active,
        remoteUpdatedAt: ec.remoteUpdatedAt,
        checksum,
      },
    });
    return { created: 1, updated: 0 };
  }
  if (existing.checksum === checksum) return { created: 0, updated: 0 };
  await prisma.lmsCourse.update({
    where: { id: existing.id },
    data: {
      name: ec.name,
      code: ec.code,
      instructor: ec.instructor,
      term: ec.term,
      active: ec.active,
      remoteUpdatedAt: ec.remoteUpdatedAt,
      checksum,
    },
  });
  return { created: 0, updated: 1 };
}

async function upsertAssignment(
  connectionId: string,
  userId: string,
  courseId: string,
  ea: ExternalAssignment,
  metrics: SyncMetrics,
): Promise<UpsertStats> {
  const remoteFields = {
    title: ea.title,
    description: ea.description,
    dueAt: ea.dueAt?.toISOString(),
    points: ea.points,
    maxPoints: ea.maxPoints,
    type: ea.type,
    submitted: ea.submitted,
  };
  const checksum = computeChecksum(remoteFields);
  const existing = await prisma.lmsAssignment.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: ea.externalId } },
    select: { id: true, checksum: true, localAssignmentId: true, updatedAt: true },
  });

  if (!existing) {
    const created = await prisma.lmsAssignment.create({
      data: {
        connectionId,
        courseId,
        userId,
        externalId: ea.externalId,
        title: ea.title,
        description: ea.description,
        dueAt: ea.dueAt,
        maxPoints: ea.maxPoints,
        type: ea.type,
        url: ea.url,
        submitted: ea.submitted,
        remoteUpdatedAt: ea.remoteUpdatedAt,
        checksum,
      },
    });
    const local = await prisma.assignment.create({
      data: {
        userId,
        title: ea.title,
        description: ea.description,
        dueAt: ea.dueAt,
        maxGrade: ea.maxPoints,
        status: ea.submitted ? 'SUBMITTED' : 'TODO',
        labels: ['lms-synced'],
      },
    });
    await prisma.lmsAssignment.update({
      where: { id: created.id },
      data: { localAssignmentId: local.id },
    });
    return { created: 1, updated: 0 };
  }

  if (existing.checksum === checksum) {
    metrics.incSkipped();
    return { created: 0, updated: 0 };
  }

  // Conflict detection: has the local mirror been edited after the last remote
  // sync? If so, don't overwrite — divert to an LmsConflict row.
  if (existing.localAssignmentId) {
    const local = await prisma.assignment.findUnique({
      where: { id: existing.localAssignmentId },
      select: {
        title: true,
        description: true,
        dueAt: true,
        maxGrade: true,
        status: true,
        updatedAt: true,
      },
    });
    const remoteChangedAt = ea.remoteUpdatedAt ?? existing.updatedAt;
    if (local && local.updatedAt > existing.updatedAt && local.updatedAt >= remoteChangedAt) {
      await recordConflict({
        connectionId,
        userId,
        entityType: 'assignment',
        entityId: existing.id,
        localData: local as unknown as Record<string, unknown>,
        remoteData: remoteFields,
        ancestorData: null,
      });
      metrics.incDuplicates();
      return { created: 0, updated: 0, conflict: true };
    }
  }

  await prisma.lmsAssignment.update({
    where: { id: existing.id },
    data: {
      title: ea.title,
      description: ea.description,
      dueAt: ea.dueAt,
      maxPoints: ea.maxPoints,
      type: ea.type,
      url: ea.url,
      submitted: ea.submitted,
      remoteUpdatedAt: ea.remoteUpdatedAt,
      checksum,
    },
  });
  if (existing.localAssignmentId) {
    await prisma.assignment.update({
      where: { id: existing.localAssignmentId },
      data: {
        title: ea.title,
        description: ea.description,
        dueAt: ea.dueAt,
        maxGrade: ea.maxPoints,
        status: ea.submitted ? 'SUBMITTED' : undefined,
      },
    });
  }
  return { created: 0, updated: 1 };
}

async function upsertExam(
  connectionId: string,
  userId: string,
  courseId: string,
  ee: ExternalExam,
): Promise<UpsertStats> {
  const checksum = computeChecksum({
    title: ee.title,
    scheduledAt: ee.scheduledAt?.toISOString(),
    location: ee.location,
    durationMinutes: ee.durationMinutes,
  });
  const existing = await prisma.lmsExam.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: ee.externalId } },
    select: { id: true, checksum: true },
  });
  if (!existing) {
    await prisma.lmsExam.create({
      data: {
        connectionId,
        courseId,
        userId,
        externalId: ee.externalId,
        title: ee.title,
        description: ee.description,
        scheduledAt: ee.scheduledAt,
        durationMinutes: ee.durationMinutes,
        location: ee.location,
        url: ee.url,
        remoteUpdatedAt: ee.remoteUpdatedAt,
        checksum,
      },
    });
    return { created: 1, updated: 0 };
  }
  if (existing.checksum === checksum) return { created: 0, updated: 0 };
  await prisma.lmsExam.update({
    where: { id: existing.id },
    data: {
      title: ee.title,
      description: ee.description,
      scheduledAt: ee.scheduledAt,
      durationMinutes: ee.durationMinutes,
      location: ee.location,
      url: ee.url,
      remoteUpdatedAt: ee.remoteUpdatedAt,
      checksum,
    },
  });
  return { created: 0, updated: 1 };
}

async function upsertAnnouncement(
  connectionId: string,
  userId: string,
  courseId: string,
  ea: ExternalAnnouncement,
): Promise<UpsertStats> {
  const checksum = computeChecksum({
    title: ea.title,
    body: ea.body,
    postedAt: ea.postedAt?.toISOString(),
  });
  const existing = await prisma.lmsAnnouncement.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: ea.externalId } },
    select: { id: true, checksum: true },
  });
  if (!existing) {
    await prisma.lmsAnnouncement.create({
      data: {
        connectionId,
        courseId,
        userId,
        externalId: ea.externalId,
        title: ea.title,
        body: ea.body,
        author: ea.author,
        postedAt: ea.postedAt,
        url: ea.url,
        remoteUpdatedAt: ea.remoteUpdatedAt,
        checksum,
      },
    });
    return { created: 1, updated: 0 };
  }
  if (existing.checksum === checksum) return { created: 0, updated: 0 };
  await prisma.lmsAnnouncement.update({
    where: { id: existing.id },
    data: {
      title: ea.title,
      body: ea.body,
      author: ea.author,
      postedAt: ea.postedAt,
      url: ea.url,
      remoteUpdatedAt: ea.remoteUpdatedAt,
      checksum,
    },
  });
  return { created: 0, updated: 1 };
}

async function upsertGrade(
  connectionId: string,
  userId: string,
  courseId: string,
  eg: ExternalGrade,
): Promise<UpsertStats> {
  let assignmentDbId: string | undefined;
  if (eg.assignmentExternalId) {
    const lmsA = await prisma.lmsAssignment.findUnique({
      where: { connectionId_externalId: { connectionId, externalId: eg.assignmentExternalId } },
      select: { id: true },
    });
    assignmentDbId = lmsA?.id;
  }

  const existing = await prisma.lmsGrade.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: eg.externalId } },
    select: { id: true },
  });
  if (!existing) {
    await prisma.lmsGrade.create({
      data: {
        connectionId,
        courseId,
        userId,
        externalId: eg.externalId,
        assignmentId: assignmentDbId,
        label: eg.label,
        score: eg.score,
        maxScore: eg.maxScore,
        percentage: eg.percentage,
        letterGrade: eg.letterGrade,
        postedAt: eg.postedAt,
      },
    });
    return { created: 1, updated: 0 };
  }
  await prisma.lmsGrade.update({
    where: { id: existing.id },
    data: {
      label: eg.label,
      score: eg.score,
      maxScore: eg.maxScore,
      percentage: eg.percentage,
      letterGrade: eg.letterGrade,
      postedAt: eg.postedAt,
      assignmentId: assignmentDbId,
    },
  });
  return { created: 0, updated: 1 };
}

async function upsertFile(
  connectionId: string,
  userId: string,
  courseId: string,
  courseName: string,
  ef: ExternalFile,
  tokens: LmsTokens,
): Promise<UpsertStats> {
  const checksum = computeChecksum({
    filename: ef.filename,
    sizeBytes: ef.sizeBytes,
    mimeType: ef.mimeType,
  });
  const existing = await prisma.lmsFile.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: ef.externalId } },
    select: { id: true, checksum: true, knowledgeDocumentId: true },
  });
  if (!existing) {
    const created = await prisma.lmsFile.create({
      data: {
        connectionId,
        courseId,
        userId,
        externalId: ef.externalId,
        filename: ef.filename,
        mimeType: ef.mimeType,
        sizeBytes: ef.sizeBytes,
        externalUrl: ef.url,
        remoteUpdatedAt: ef.remoteUpdatedAt,
        checksum,
      },
    });
    void ingestLmsFileIntoKnowledgeBase(userId, created.id, courseName, ef, tokens);
    return { created: 1, updated: 0 };
  }
  if (existing.checksum === checksum) return { created: 0, updated: 0 };
  await prisma.lmsFile.update({
    where: { id: existing.id },
    data: {
      filename: ef.filename,
      mimeType: ef.mimeType,
      sizeBytes: ef.sizeBytes,
      externalUrl: ef.url,
      remoteUpdatedAt: ef.remoteUpdatedAt,
      checksum,
    },
  });
  return { created: 0, updated: 1 };
}

async function ingestLmsFileIntoKnowledgeBase(
  userId: string,
  lmsFileId: string,
  courseName: string,
  ef: ExternalFile,
  tokens: LmsTokens,
): Promise<void> {
  try {
    if (!ef.url || !ef.mimeType) return;
    try {
      resolveType(ef.mimeType, ef.filename);
    } catch {
      return;
    }

    const res = await fetch(ef.url, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!res.ok) {
      logger.warn({ lmsFileId, status: res.status }, 'lms: file download failed');
      return;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > 25 * 1024 * 1024) {
      logger.warn({ lmsFileId, size: buffer.byteLength }, 'lms: file exceeds 25MB, skipping');
      return;
    }

    let extractedText: string | null = null;
    const spec = resolveType(ef.mimeType, ef.filename);
    if (spec.mode === 'gemini' && env.hasGemini) {
      try {
        const result = await generateFromPrompt(
          'Extract all readable text from this document verbatim. Return only the extracted text.',
          {
            attachments: [{ mimeType: ef.mimeType, dataBase64: buffer.toString('base64') }],
            maxOutputTokens: 8192,
          },
        );
        extractedText = result.text.trim() || null;
      } catch (err) {
        logger.warn({ err, lmsFileId }, 'lms: Gemini extraction failed');
      }
    } else {
      extractedText = await extractText(buffer, ef.mimeType, ef.filename);
    }

    const doc = await prisma.knowledgeDocument.create({
      data: {
        userId,
        filename: ef.filename,
        mimeType: ef.mimeType,
        sizeBytes: ef.sizeBytes ?? buffer.byteLength,
        storageUrl: ef.url,
        storageKey: `lms:${lmsFileId}`,
        tags: ['lms', courseName],
        extractedText: extractedText ?? undefined,
      },
    });

    if (extractedText) {
      const chunks = chunkText(extractedText);
      await prisma.knowledgeChunk.createMany({
        data: chunks.map((c, i) => ({ documentId: doc.id, chunkIndex: i, content: c })),
      });
      await prisma.knowledgeDocument.update({
        where: { id: doc.id },
        data: { chunkCount: chunks.length },
      });
    }

    await prisma.lmsFile.update({
      where: { id: lmsFileId },
      data: { knowledgeDocumentId: doc.id, downloadedAt: new Date() },
    });
  } catch (err) {
    logger.error({ err, lmsFileId }, 'lms: knowledge-base ingest failed');
  }
}

function chunkText(text: string, size = 2000, overlap = 200): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + size, text.length);
    out.push(text.slice(i, end));
    i += size - overlap;
  }
  return out;
}

async function upsertCalendarBlock(
  userId: string,
  _courseId: string,
  evt: ExternalCalendarEvent,
): Promise<void> {
  const existing = await prisma.scheduleBlock.findFirst({
    where: { userId, title: evt.title, startAt: evt.startAt },
    select: { id: true },
  });
  if (existing) return;

  const type =
    evt.type === 'exam' ? 'EXAM' : evt.type === 'lecture' ? 'CLASS' : 'STUDY';
  await prisma.scheduleBlock.create({
    data: {
      userId,
      title: evt.title,
      startAt: evt.startAt,
      endAt: evt.endAt ?? new Date(evt.startAt.getTime() + 60 * 60_000),
      type,
      location: evt.location,
      aiGenerated: false,
    },
  });
}

// ---------------------------------------------------------------------------
// Dry-run planners — populate the SyncPlan without touching the DB (except
// read-only lookups against LmsXxx tables to compute updated/duplicate).
// ---------------------------------------------------------------------------

async function planCourse(connectionId: string, ec: ExternalCourse, bucket: EntityPlan) {
  const checksum = computeChecksum({
    name: ec.name,
    code: ec.code,
    instructor: ec.instructor,
    term: ec.term,
    active: ec.active,
  });
  const existing = await prisma.lmsCourse.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: ec.externalId } },
    select: { checksum: true },
  });
  const sample = { externalId: ec.externalId, label: ec.name };
  if (!existing) pushSample(bucket.new, sample);
  else if (existing.checksum === checksum) pushSample(bucket.duplicate, sample);
  else pushSample(bucket.updated, sample);
}

async function planAssignment(
  connectionId: string,
  ea: ExternalAssignment,
  bucket: EntityPlan,
  courseName: string,
) {
  const checksum = computeChecksum({
    title: ea.title,
    description: ea.description,
    dueAt: ea.dueAt?.toISOString(),
    points: ea.points,
    maxPoints: ea.maxPoints,
    type: ea.type,
    submitted: ea.submitted,
  });
  const existing = await prisma.lmsAssignment.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: ea.externalId } },
    select: { checksum: true },
  });
  const sample = { externalId: ea.externalId, label: ea.title, courseName };
  if (!existing) pushSample(bucket.new, sample);
  else if (existing.checksum === checksum) pushSample(bucket.duplicate, sample);
  else pushSample(bucket.updated, sample);
}

async function planExam(
  connectionId: string,
  ee: ExternalExam,
  bucket: EntityPlan,
  courseName: string,
) {
  const checksum = computeChecksum({
    title: ee.title,
    scheduledAt: ee.scheduledAt?.toISOString(),
    location: ee.location,
    durationMinutes: ee.durationMinutes,
  });
  const existing = await prisma.lmsExam.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: ee.externalId } },
    select: { checksum: true },
  });
  const sample = { externalId: ee.externalId, label: ee.title, courseName };
  if (!existing) pushSample(bucket.new, sample);
  else if (existing.checksum === checksum) pushSample(bucket.duplicate, sample);
  else pushSample(bucket.updated, sample);
}

async function planAnnouncement(
  connectionId: string,
  ea: ExternalAnnouncement,
  bucket: EntityPlan,
  courseName: string,
) {
  const checksum = computeChecksum({
    title: ea.title,
    body: ea.body,
    postedAt: ea.postedAt?.toISOString(),
  });
  const existing = await prisma.lmsAnnouncement.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: ea.externalId } },
    select: { checksum: true },
  });
  const sample = { externalId: ea.externalId, label: ea.title, courseName };
  if (!existing) pushSample(bucket.new, sample);
  else if (existing.checksum === checksum) pushSample(bucket.duplicate, sample);
  else pushSample(bucket.updated, sample);
}

async function planGrade(
  connectionId: string,
  eg: ExternalGrade,
  bucket: EntityPlan,
  courseName: string,
) {
  const existing = await prisma.lmsGrade.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: eg.externalId } },
    select: { id: true },
  });
  const sample = {
    externalId: eg.externalId,
    label: `${eg.label}${eg.score != null ? `: ${eg.score}${eg.maxScore != null ? '/' + eg.maxScore : ''}` : ''}`,
    courseName,
  };
  if (!existing) pushSample(bucket.new, sample);
  else pushSample(bucket.updated, sample);
}

async function planFile(
  connectionId: string,
  ef: ExternalFile,
  bucket: EntityPlan,
  courseName: string,
) {
  const checksum = computeChecksum({
    filename: ef.filename,
    sizeBytes: ef.sizeBytes,
    mimeType: ef.mimeType,
  });
  const existing = await prisma.lmsFile.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: ef.externalId } },
    select: { checksum: true },
  });
  const sample = { externalId: ef.externalId, label: ef.filename, courseName };
  if (!existing) pushSample(bucket.new, sample);
  else if (existing.checksum === checksum) pushSample(bucket.duplicate, sample);
  else pushSample(bucket.updated, sample);
}

// ---------------------------------------------------------------------------
// Conflict recording — invoked from upserters when local + remote both moved.
// ---------------------------------------------------------------------------

async function recordConflict(input: {
  connectionId: string;
  userId: string;
  entityType: string;
  entityId: string;
  localData: Record<string, unknown>;
  remoteData: Record<string, unknown>;
  ancestorData: Record<string, unknown> | null;
}): Promise<void> {
  // De-dupe: only one PENDING conflict per (entityType, entityId).
  const existing = await prisma.lmsConflict.findFirst({
    where: {
      entityType: input.entityType,
      entityId: input.entityId,
      status: 'PENDING',
    },
    select: { id: true },
  });
  if (existing) return;
  await prisma.lmsConflict.create({
    data: {
      connectionId: input.connectionId,
      userId: input.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      localData: input.localData as unknown as Prisma.InputJsonValue,
      remoteData: input.remoteData as unknown as Prisma.InputJsonValue,
      ancestorData: input.ancestorData
        ? (input.ancestorData as unknown as Prisma.InputJsonValue)
        : undefined,
    },
  });
  await notify(
    input.userId,
    'LMS_ANNOUNCEMENT',
    'Sync conflict detected',
    `A locally-edited ${input.entityType} diverged from the remote copy. Resolve in University → Conflicts.`,
    '/university/conflicts',
  );
}

// ---------------------------------------------------------------------------
// Notifications helper — one call site so the type stays coherent.
// ---------------------------------------------------------------------------

async function notify(
  userId: string,
  type: 'LMS_SYNC_COMPLETE' | 'LMS_NEW_ASSIGNMENT' | 'LMS_NEW_GRADE' | 'LMS_ANNOUNCEMENT',
  title: string,
  body: string | undefined,
  link: string,
): Promise<void> {
  await prisma.notification.create({
    data: { userId, type, title, body, link },
  });
}

function formatDue(due?: Date): string {
  if (!due) return 'No due date set';
  return `Due ${due.toLocaleDateString()}`;
}

function zeroCounts() {
  return {
    coursesFound: 0,
    assignmentsFound: 0,
    examsFound: 0,
    announcementsFound: 0,
    gradesFound: 0,
    filesFound: 0,
    coursesCreated: 0,
    coursesUpdated: 0,
    assignmentsCreated: 0,
    assignmentsUpdated: 0,
    examsCreated: 0,
    examsUpdated: 0,
    announcementsCreated: 0,
    announcementsUpdated: 0,
    gradesCreated: 0,
    gradesUpdated: 0,
    filesCreated: 0,
    filesUpdated: 0,
  };
}

// ---------------------------------------------------------------------------
// Synced data queries.
// ---------------------------------------------------------------------------

async function listCourses(userId: string, connectionId?: string) {
  const where: Prisma.LmsCourseWhereInput = { userId };
  if (connectionId) where.connectionId = connectionId;
  return prisma.lmsCourse.findMany({
    where,
    orderBy: { name: 'asc' },
    include: {
      connection: { select: { displayName: true, provider: true } },
      _count: {
        select: { assignments: true, exams: true, announcements: true, files: true },
      },
    },
  });
}

async function listAnnouncements(userId: string, courseId?: string) {
  const where: Prisma.LmsAnnouncementWhereInput = { userId };
  if (courseId) where.courseId = courseId;
  return prisma.lmsAnnouncement.findMany({
    where,
    orderBy: { postedAt: 'desc' },
    take: 50,
    include: { course: { select: { name: true } } },
  });
}

async function listGrades(userId: string, courseId?: string) {
  const where: Prisma.LmsGradeWhereInput = { userId };
  if (courseId) where.courseId = courseId;
  return prisma.lmsGrade.findMany({
    where,
    orderBy: { postedAt: 'desc' },
    take: 100,
    include: { course: { select: { name: true } } },
  });
}

async function listFiles(userId: string, courseId?: string) {
  const where: Prisma.LmsFileWhereInput = { userId };
  if (courseId) where.courseId = courseId;
  return prisma.lmsFile.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { course: { select: { name: true } } },
  });
}

async function getConnectionsDueForSync(userId: string): Promise<string[]> {
  const connections = await prisma.lmsConnection.findMany({
    where: {
      userId,
      autoSync: true,
      status: { in: ['CONNECTED', 'ERROR'] },
    },
    select: { id: true, syncInterval: true, lastSyncAt: true },
  });
  const now = Date.now();
  return connections
    .filter((c) => {
      if (!c.lastSyncAt) return true;
      const elapsed = (now - c.lastSyncAt.getTime()) / 60_000;
      return elapsed >= c.syncInterval;
    })
    .map((c) => c.id);
}

/**
 * Applies a resolved conflict's chosen data back to the mirrored local record.
 * Called by lms-conflict.service.ts after the user picks KEEP_LOCAL / KEEP_REMOTE
 * / MERGE. Ancestor and remote-only branches are handled here so all mutation
 * paths funnel through the same code.
 */
export async function applyConflictResolution(
  conflictId: string,
  choice: 'KEEP_LOCAL' | 'KEEP_REMOTE' | 'MERGE' | 'IGNORE',
  mergedData?: Record<string, unknown>,
): Promise<void> {
  const conflict = await prisma.lmsConflict.findUnique({
    where: { id: conflictId },
    select: {
      id: true,
      entityType: true,
      entityId: true,
      localData: true,
      remoteData: true,
      userId: true,
    },
  });
  if (!conflict) throw new NotFoundError('Conflict');

  const winning =
    choice === 'KEEP_LOCAL'
      ? (conflict.localData as Record<string, unknown>)
      : choice === 'KEEP_REMOTE'
        ? (conflict.remoteData as Record<string, unknown>)
        : choice === 'MERGE'
          ? (mergedData ?? {})
          : null;

  if (choice === 'IGNORE' || winning === null) return;

  if (conflict.entityType === 'assignment') {
    const lms = await prisma.lmsAssignment.findUnique({
      where: { id: conflict.entityId },
      select: { localAssignmentId: true },
    });
    if (lms?.localAssignmentId) {
      await prisma.assignment.update({
        where: { id: lms.localAssignmentId },
        data: {
          title: (winning.title as string | undefined) ?? undefined,
          description: winning.description as string | null | undefined,
          dueAt: winning.dueAt ? new Date(winning.dueAt as string) : undefined,
          maxGrade: winning.maxPoints as number | null | undefined,
        },
      });
    }
    // Also update the LmsAssignment mirror so a future sync doesn't re-trigger
    // the same conflict against the accepted value.
    await prisma.lmsAssignment.update({
      where: { id: conflict.entityId },
      data: {
        title: (winning.title as string | undefined) ?? undefined,
        description: winning.description as string | null | undefined,
        dueAt: winning.dueAt ? new Date(winning.dueAt as string) : undefined,
        maxPoints: winning.maxPoints as number | null | undefined,
        checksum: createHash('sha256').update(JSON.stringify(winning)).digest('hex').slice(0, 32),
      },
    });
  }
}

export const universitySyncService = {
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  deleteConnection,
  getDashboard,
  listSyncLogs,
  triggerSync,
  listCourses,
  listAnnouncements,
  listGrades,
  listFiles,
  getConnectionsDueForSync,
  registerScheduler,
};

// Re-export for the conflict service.
export { hasCapability, type Capability };
