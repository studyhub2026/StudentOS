import crypto from 'node:crypto';
import { Prisma, type SharePermission } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import type {
  CreateNoteInput,
  ListNotesQuery,
  UpdateNoteInput,
} from '../validators/note.validator.js';

const noteInclude = {
  subject: { select: { id: true, name: true, color: true } },
  folder: { select: { id: true, name: true, color: true } },
  attachments: {
    select: { id: true, filename: true, mimeType: true, sizeBytes: true, url: true },
  },
  _count: { select: { versions: true, shares: true } },
} satisfies Prisma.NoteInclude;

export type NoteWithRelations = Prisma.NoteGetPayload<{ include: typeof noteInclude }>;

/** Retained versions per note. Older snapshots are pruned on write. */
const MAX_VERSIONS = 50;

/**
 * Approximate word count over markdown source. Fences, links and emphasis are
 * stripped so formatting characters don't inflate the total.
 */
export function countWords(markdown: string): number {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~-]/g, ' ');

  const words = plain.trim().match(/\S+/g);
  return words ? words.length : 0;
}

/** First meaningful line of prose, used as the list preview. */
export function buildExcerpt(markdown: string, maxLength = 180): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return plain.length <= maxLength ? plain : `${plain.slice(0, maxLength).trimEnd()}…`;
}

function buildWhere(userId: string, query: ListNotesQuery): Prisma.NoteWhereInput {
  const where: Prisma.NoteWhereInput = { userId, deletedAt: null };

  // Trash, archive and the active list are mutually exclusive views.
  if (query.view === 'trash') {
    where.deletedAt = { not: null };
  } else if (query.view === 'archived') {
    where.archivedAt = { not: null };
  } else {
    where.archivedAt = null;
    if (query.view === 'favorites') where.favorite = true;
  }

  if (query.folderId) where.folderId = query.folderId;
  if (query.subjectId) where.subjectId = query.subjectId;
  if (query.tags?.length) where.tags = { hasSome: query.tags };

  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { content: { contains: query.search, mode: 'insensitive' } },
      { tags: { has: query.search } },
    ];
  }

  return where;
}

export interface PaginatedNotes {
  items: NoteWithRelations[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

export async function listNotes(
  userId: string,
  query: ListNotesQuery,
): Promise<PaginatedNotes> {
  const where = buildWhere(userId, query);
  const skip = (query.page - 1) * query.limit;

  const [items, total] = await Promise.all([
    prisma.note.findMany({
      where,
      include: noteInclude,
      // Pinned notes float to the top of every view.
      orderBy: [{ pinned: 'desc' }, { [query.sortBy]: query.sortOrder }],
      skip,
      take: query.limit,
    }),
    prisma.note.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / query.limit));

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

export async function getNote(userId: string, id: string): Promise<NoteWithRelations> {
  const note = await prisma.note.findFirst({
    where: { id, userId },
    include: noteInclude,
  });
  if (!note) throw new NotFoundError('Note');
  return note;
}

async function assertFolderOwned(userId: string, folderId: string): Promise<void> {
  const folder = await prisma.noteFolder.findFirst({
    where: { id: folderId, userId },
    select: { id: true },
  });
  if (!folder) throw new BadRequestError('That folder does not exist');
}

export async function createNote(
  userId: string,
  input: CreateNoteInput,
): Promise<NoteWithRelations> {
  if (input.folderId) await assertFolderOwned(userId, input.folderId);

  const content = input.content ?? '';

  return prisma.note.create({
    data: {
      userId,
      title: input.title,
      content,
      contentJson: (input.contentJson as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      excerpt: buildExcerpt(content),
      wordCount: countWords(content),
      tags: input.tags ?? [],
      folderId: input.folderId ?? null,
      subjectId: input.subjectId ?? null,
      pinned: input.pinned ?? false,
      favorite: input.favorite ?? false,
    },
    include: noteInclude,
  });
}

/**
 * Updates a note, snapshotting the previous content first.
 *
 * A version is only recorded when the body actually changed — autosave fires
 * often and would otherwise fill the history with identical entries.
 */
export async function updateNote(
  userId: string,
  id: string,
  input: UpdateNoteInput,
  options: { automatic?: boolean } = {},
): Promise<NoteWithRelations> {
  const existing = await prisma.note.findFirst({
    where: { id, userId },
    select: { id: true, title: true, content: true, wordCount: true },
  });
  if (!existing) throw new NotFoundError('Note');

  if (input.folderId) await assertFolderOwned(userId, input.folderId);

  const contentChanged = input.content !== undefined && input.content !== existing.content;

  const data: Prisma.NoteUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.pinned !== undefined) data.pinned = input.pinned;
  if (input.favorite !== undefined) data.favorite = input.favorite;
  if (input.contentJson !== undefined) {
    data.contentJson = (input.contentJson as Prisma.InputJsonValue | null) ?? Prisma.JsonNull;
  }

  if (input.content !== undefined) {
    data.content = input.content;
    data.excerpt = buildExcerpt(input.content);
    data.wordCount = countWords(input.content);
  }

  if (input.folderId !== undefined) {
    data.folder = input.folderId ? { connect: { id: input.folderId } } : { disconnect: true };
  }
  if (input.subjectId !== undefined) {
    data.subject = input.subjectId ? { connect: { id: input.subjectId } } : { disconnect: true };
  }

  if (!contentChanged) {
    return prisma.note.update({ where: { id }, data, include: noteInclude });
  }

  // Snapshot the outgoing content and apply the update atomically, so history
  // can never record a version the note never actually had.
  const latest = await prisma.noteVersion.findFirst({
    where: { noteId: id },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  const [, note] = await prisma.$transaction([
    prisma.noteVersion.create({
      data: {
        noteId: id,
        title: existing.title,
        content: existing.content,
        wordCount: existing.wordCount,
        automatic: options.automatic ?? false,
        // Monotonic per note. The unique constraint on (noteId, version)
        // turns a concurrent double-save into a retryable error rather than
        // two snapshots silently sharing a number.
        version: (latest?.version ?? 0) + 1,
      },
    }),
    prisma.note.update({ where: { id }, data, include: noteInclude }),
  ]);

  await pruneVersions(id);
  return note;
}

/** Trims history to the newest MAX_VERSIONS snapshots. */
async function pruneVersions(noteId: string): Promise<void> {
  const total = await prisma.noteVersion.count({ where: { noteId } });
  if (total <= MAX_VERSIONS) return;

  const stale = await prisma.noteVersion.findMany({
    where: { noteId },
    orderBy: { version: 'asc' },
    take: total - MAX_VERSIONS,
    select: { id: true },
  });

  await prisma.noteVersion.deleteMany({
    where: { id: { in: stale.map((entry) => entry.id) } },
  });
}

export async function listVersions(userId: string, noteId: string) {
  await getNote(userId, noteId);

  return prisma.noteVersion.findMany({
    where: { noteId },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      version: true,
      title: true,
      wordCount: true,
      automatic: true,
      createdAt: true,
    },
  });
}

export async function getVersion(userId: string, noteId: string, versionId: string) {
  await getNote(userId, noteId);

  const version = await prisma.noteVersion.findFirst({
    where: { id: versionId, noteId },
  });
  if (!version) throw new NotFoundError('Version');
  return version;
}

/**
 * Restores a historical version. The current content is snapshotted first, so
 * restoring is itself undoable.
 */
export async function restoreVersion(
  userId: string,
  noteId: string,
  versionId: string,
): Promise<NoteWithRelations> {
  const version = await getVersion(userId, noteId, versionId);

  return updateNote(
    userId,
    noteId,
    { title: version.title, content: version.content },
    { automatic: false },
  );
}

export async function setFavorite(
  userId: string,
  id: string,
  favorite: boolean,
): Promise<NoteWithRelations> {
  const result = await prisma.note.updateMany({
    where: { id, userId, deletedAt: null },
    data: { favorite },
  });
  if (result.count === 0) throw new NotFoundError('Note');
  return getNote(userId, id);
}

export async function setArchived(
  userId: string,
  id: string,
  archived: boolean,
): Promise<NoteWithRelations> {
  const result = await prisma.note.updateMany({
    where: { id, userId, deletedAt: null },
    data: { archivedAt: archived ? new Date() : null },
  });
  if (result.count === 0) throw new NotFoundError('Note');
  return getNote(userId, id);
}

export async function deleteNote(userId: string, id: string): Promise<void> {
  const result = await prisma.note.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new NotFoundError('Note');
}

export async function restoreNote(userId: string, id: string): Promise<NoteWithRelations> {
  const result = await prisma.note.updateMany({
    where: { id, userId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
  if (result.count === 0) throw new NotFoundError('Note');
  return getNote(userId, id);
}

/** Irreversible. Only reachable for notes already in the trash. */
export async function purgeNote(userId: string, id: string): Promise<void> {
  const result = await prisma.note.deleteMany({
    where: { id, userId, deletedAt: { not: null } },
  });
  if (result.count === 0) {
    throw new NotFoundError('Deleted note');
  }
}

/** Distinct tags across a user's notes, for filter autocomplete. */
export async function listTags(userId: string): Promise<string[]> {
  const rows = await prisma.note.findMany({
    where: { userId, deletedAt: null },
    select: { tags: true },
  });
  return [...new Set(rows.flatMap((row) => row.tags))].sort((a, b) => a.localeCompare(b));
}

// --- Folders ----------------------------------------------------------------

export async function listFolders(userId: string) {
  const folders = await prisma.noteFolder.findMany({
    where: { userId },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { notes: { where: { deletedAt: null, archivedAt: null } } } },
    },
  });

  return folders.map(({ _count, ...folder }) => ({
    ...folder,
    noteCount: _count.notes,
  }));
}

export async function createFolder(
  userId: string,
  input: { name: string; color?: string | null; parentId?: string | null },
) {
  if (input.parentId) await assertFolderOwned(userId, input.parentId);

  return prisma.noteFolder.create({
    data: {
      userId,
      name: input.name,
      color: input.color ?? null,
      parentId: input.parentId ?? null,
    },
  });
}

export async function updateFolder(
  userId: string,
  id: string,
  input: { name?: string; color?: string | null; parentId?: string | null },
) {
  const existing = await prisma.noteFolder.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('Folder');

  // A folder cannot be its own parent, which would orphan the subtree.
  if (input.parentId === id) {
    throw new BadRequestError('A folder cannot contain itself');
  }
  if (input.parentId) {
    await assertFolderOwned(userId, input.parentId);
    if (await isDescendant(input.parentId, id)) {
      throw new BadRequestError('Cannot move a folder into its own subtree');
    }
  }

  const data: Prisma.NoteFolderUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.color !== undefined) data.color = input.color;
  if (input.parentId !== undefined) {
    data.parent = input.parentId ? { connect: { id: input.parentId } } : { disconnect: true };
  }

  return prisma.noteFolder.update({ where: { id }, data });
}

/** Walks up from `candidate` looking for `ancestorId`. */
async function isDescendant(candidateId: string, ancestorId: string): Promise<boolean> {
  let currentId: string | null = candidateId;

  // Bounded to avoid an infinite walk if data is ever cyclic.
  for (let depth = 0; depth < 32 && currentId; depth += 1) {
    if (currentId === ancestorId) return true;
    const parent: { parentId: string | null } | null = await prisma.noteFolder.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    currentId = parent?.parentId ?? null;
  }

  return false;
}

export async function deleteFolder(userId: string, id: string): Promise<void> {
  const result = await prisma.noteFolder.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new NotFoundError('Folder');
}

// --- Sharing ----------------------------------------------------------------

export async function shareNote(
  userId: string,
  noteId: string,
  input: { sharedWithId?: string | null; permission: SharePermission; createLink?: boolean },
) {
  await getNote(userId, noteId);

  if (input.sharedWithId === userId) {
    throw new BadRequestError('You already own this note');
  }

  if (input.sharedWithId) {
    const target = await prisma.user.findUnique({
      where: { id: input.sharedWithId },
      select: { id: true, deletedAt: true },
    });
    if (!target || target.deletedAt) throw new BadRequestError('That user does not exist');
  }

  // User shares and link shares are handled separately: the (noteId,
  // sharedWithId) unique cannot be used for a lookup when sharedWithId is
  // null, and Postgres would not treat two null rows as duplicates anyway.
  if (input.sharedWithId) {
    return prisma.noteShare.upsert({
      where: {
        noteId_sharedWithId: { noteId, sharedWithId: input.sharedWithId },
      },
      create: {
        noteId,
        sharedWithId: input.sharedWithId,
        permission: input.permission,
      },
      update: { permission: input.permission },
    });
  }

  // At most one link share per note — reuse the existing row so an old link
  // is rotated rather than leaving several valid tokens behind.
  const existingLink = await prisma.noteShare.findFirst({
    where: { noteId, sharedWithId: null },
    select: { id: true },
  });

  const linkToken = crypto.randomBytes(24).toString('base64url');

  if (existingLink) {
    return prisma.noteShare.update({
      where: { id: existingLink.id },
      data: { permission: input.permission, linkToken },
    });
  }

  return prisma.noteShare.create({
    data: { noteId, sharedWithId: null, permission: input.permission, linkToken },
  });
}

export async function listShares(userId: string, noteId: string) {
  await getNote(userId, noteId);

  return prisma.noteShare.findMany({
    where: { noteId },
    include: {
      sharedWith: { select: { id: true, name: true, username: true, avatarUrl: true } },
    },
  });
}

export async function revokeShare(
  userId: string,
  noteId: string,
  shareId: string,
): Promise<void> {
  await getNote(userId, noteId);
  const result = await prisma.noteShare.deleteMany({ where: { id: shareId, noteId } });
  if (result.count === 0) throw new NotFoundError('Share');
}

/** Resolves a share link for a viewer who may not own the note. */
export async function getSharedNote(linkToken: string) {
  const share = await prisma.noteShare.findUnique({
    where: { linkToken },
    include: { note: { include: noteInclude } },
  });

  if (!share || (share.expiresAt && share.expiresAt < new Date())) {
    throw new NotFoundError('Shared note');
  }
  if (share.note.deletedAt) throw new NotFoundError('Shared note');

  return { note: share.note, permission: share.permission };
}

/** Notes other people have shared directly with this user. */
export async function listNotesSharedWithMe(userId: string) {
  const shares = await prisma.noteShare.findMany({
    where: { sharedWithId: userId },
    include: {
      note: {
        include: {
          ...noteInclude,
          user: { select: { id: true, name: true, username: true, avatarUrl: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return shares
    .filter((share) => !share.note.deletedAt)
    .map((share) => ({ ...share.note, permission: share.permission }));
}

/** Confirms a viewer may read, and optionally write, a note. */
export async function assertCanAccess(
  userId: string,
  noteId: string,
  need: 'read' | 'write',
): Promise<void> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { userId: true, deletedAt: true },
  });
  if (!note || note.deletedAt) throw new NotFoundError('Note');
  if (note.userId === userId) return;

  const share = await prisma.noteShare.findUnique({
    where: { noteId_sharedWithId: { noteId, sharedWithId: userId } },
    select: { permission: true, expiresAt: true },
  });

  if (!share || (share.expiresAt && share.expiresAt < new Date())) {
    throw new NotFoundError('Note');
  }
  if (need === 'write' && share.permission !== 'EDIT') {
    throw new ForbiddenError('You have read-only access to this note');
  }
}

export const noteService = {
  listNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  restoreNote,
  purgeNote,
  setFavorite,
  setArchived,
  listTags,
  listVersions,
  getVersion,
  restoreVersion,
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  shareNote,
  listShares,
  revokeShare,
  getSharedNote,
  listNotesSharedWithMe,
  assertCanAccess,
  countWords,
  buildExcerpt,
} as const;
