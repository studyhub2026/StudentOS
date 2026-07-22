import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { aiStudyService } from '../services/ai-study.service.js';
import { noteService } from '../services/note.service.js';
import { UnauthorizedError } from '../utils/errors.js';
import type {
  CreateFolderInput,
  CreateNoteInput,
  ListNotesQuery,
  ShareNoteInput,
  UpdateFolderInput,
  UpdateNoteInput,
} from '../validators/note.validator.js';

function userId(req: Request): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}

export async function list(req: Request, res: Response): Promise<void> {
  const result = await noteService.listNotes(
    userId(req),
    req.query as unknown as ListNotesQuery,
  );
  res.json({ success: true, data: result.items, pagination: result.pagination });
}

export async function getById(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await noteService.getNote(userId(req), req.params.id as string) });
}

export async function create(req: Request, res: Response): Promise<void> {
  const note = await noteService.createNote(userId(req), req.body as CreateNoteInput);
  res.status(201).json({ success: true, data: note });
}

export async function update(req: Request, res: Response): Promise<void> {
  const note = await noteService.updateNote(
    userId(req),
    req.params.id as string,
    req.body as UpdateNoteInput,
  );
  res.json({ success: true, data: note });
}

/** Autosave — identical persistence, but versions are flagged automatic. */
export async function autosave(req: Request, res: Response): Promise<void> {
  const note = await noteService.updateNote(
    userId(req),
    req.params.id as string,
    req.body as UpdateNoteInput,
    { automatic: true },
  );
  res.json({
    success: true,
    data: { id: note.id, updatedAt: note.updatedAt, wordCount: note.wordCount },
  });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await noteService.deleteNote(userId(req), req.params.id as string);
  res.json({ success: true, data: { message: 'Note moved to trash' } });
}

export async function restore(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await noteService.restoreNote(userId(req), req.params.id as string) });
}

export async function purge(req: Request, res: Response): Promise<void> {
  await noteService.purgeNote(userId(req), req.params.id as string);
  res.json({ success: true, data: { message: 'Note permanently deleted' } });
}

export async function setFavorite(req: Request, res: Response): Promise<void> {
  const { favorite } = req.body as { favorite: boolean };
  res.json({
    success: true,
    data: await noteService.setFavorite(userId(req), req.params.id as string, favorite),
  });
}

export async function setArchived(req: Request, res: Response): Promise<void> {
  const { archived } = req.body as { archived: boolean };
  res.json({
    success: true,
    data: await noteService.setArchived(userId(req), req.params.id as string, archived),
  });
}

export async function tags(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await noteService.listTags(userId(req)) });
}

// --- Versions ---------------------------------------------------------------

export async function listVersions(req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    data: await noteService.listVersions(userId(req), req.params.id as string),
  });
}

export async function getVersion(req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    data: await noteService.getVersion(
      userId(req),
      req.params.id as string,
      req.params.versionId as string,
    ),
  });
}

export async function restoreVersion(req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    data: await noteService.restoreVersion(
      userId(req),
      req.params.id as string,
      req.params.versionId as string,
    ),
  });
}

// --- Folders ----------------------------------------------------------------

export async function listFolders(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await noteService.listFolders(userId(req)) });
}

export async function createFolder(req: Request, res: Response): Promise<void> {
  const folder = await noteService.createFolder(userId(req), req.body as CreateFolderInput);
  res.status(201).json({ success: true, data: folder });
}

export async function updateFolder(req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    data: await noteService.updateFolder(
      userId(req),
      req.params.id as string,
      req.body as UpdateFolderInput,
    ),
  });
}

export async function removeFolder(req: Request, res: Response): Promise<void> {
  await noteService.deleteFolder(userId(req), req.params.id as string);
  res.json({ success: true, data: { message: 'Folder deleted' } });
}

// --- Sharing ----------------------------------------------------------------

export async function share(req: Request, res: Response): Promise<void> {
  const result = await noteService.shareNote(
    userId(req),
    req.params.id as string,
    req.body as ShareNoteInput,
  );
  res.status(201).json({ success: true, data: result });
}

export async function listShares(req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    data: await noteService.listShares(userId(req), req.params.id as string),
  });
}

export async function revokeShare(req: Request, res: Response): Promise<void> {
  await noteService.revokeShare(
    userId(req),
    req.params.id as string,
    req.params.shareId as string,
  );
  res.json({ success: true, data: { message: 'Share revoked' } });
}

export async function sharedWithMe(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await noteService.listNotesSharedWithMe(userId(req)) });
}

/** Public: resolves a share link without requiring authentication. */
export async function getByLink(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await noteService.getSharedNote(req.params.token as string) });
}

// --- AI ---------------------------------------------------------------------

/** Summarises a note with Gemini and caches the result on the record. */
export async function summarise(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const note = await noteService.getNote(userId(req), id);

  const result = await aiStudyService.summariseNote(note.content);

  await prisma.note.update({
    where: { id },
    data: { aiSummary: result.summary, aiSummaryAt: new Date() },
  });

  res.json({
    success: true,
    data: {
      summary: result.summary,
      keyPoints: result.keyPoints,
      model: result.model,
      totalTokens: result.totalTokens,
    },
  });
}
