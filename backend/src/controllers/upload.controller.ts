import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { groupService } from '../services/group.service.js';
import { noteService } from '../services/note.service.js';
import { uploadService, type UploadFolder } from '../services/upload.service.js';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../utils/errors.js';
import type { RegisterUploadInput, SignUploadInput } from '../validators/upload.validator.js';

function userId(req: Request): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}

export function status(_req: Request, res: Response): void {
  res.json({
    success: true,
    data: { configured: uploadService.isConfigured(), provider: 'cloudinary' },
  });
}

/** Mints a short-lived signature for a direct browser → Cloudinary upload. */
export function sign(req: Request, res: Response): void {
  const { folder } = req.body as SignUploadInput;
  res.json({
    success: true,
    data: uploadService.createSignedUpload(userId(req), folder as UploadFolder),
  });
}

/**
 * Records a completed upload against its owning entity.
 *
 * The client's report is validated against the signed public id and the folder
 * policy before anything is written, so this cannot be used to attach an
 * arbitrary URL.
 */
export async function register(req: Request, res: Response): Promise<void> {
  const owner = userId(req);
  const input = req.body as RegisterUploadInput;

  uploadService.validateUploadResult(owner, input.folder as UploadFolder, {
    publicId: input.publicId,
    url: input.url,
    bytes: input.sizeBytes,
    format: input.format,
  });

  // Confirm the target belongs to this user before linking anything to it.
  if (input.assignmentId) {
    const assignment = await prisma.assignment.findFirst({
      where: { id: input.assignmentId, userId: owner, deletedAt: null },
      select: { id: true },
    });
    if (!assignment) throw new NotFoundError('Assignment');
  }

  if (input.noteId) {
    await noteService.assertCanAccess(owner, input.noteId, 'write');
  }

  if (input.messageId) {
    const message = await prisma.message.findFirst({
      where: { id: input.messageId, authorId: owner },
      select: { id: true, channel: { select: { groupId: true } } },
    });
    if (!message) throw new NotFoundError('Message');
    if (message.channel.groupId) {
      await groupService.requireMembership(owner, message.channel.groupId);
    }
  }

  const asset = await prisma.fileAsset.create({
    data: {
      userId: owner,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      url: input.url,
      publicId: input.publicId,
      width: input.width ?? null,
      height: input.height ?? null,
      assignmentId: input.assignmentId ?? null,
      noteId: input.noteId ?? null,
      messageId: input.messageId ?? null,
    },
  });

  res.status(201).json({ success: true, data: asset });
}

/** Sets the user's avatar, removing the previous asset from Cloudinary. */
export async function setAvatar(req: Request, res: Response): Promise<void> {
  const owner = userId(req);
  const input = req.body as RegisterUploadInput;

  uploadService.validateUploadResult(owner, 'avatars', {
    publicId: input.publicId,
    url: input.url,
    bytes: input.sizeBytes,
    format: input.format,
  });

  const previous = await prisma.fileAsset.findFirst({
    where: { userId: owner, publicId: { startsWith: `studentos/avatars/${owner}/` } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, publicId: true },
  });

  const [, user] = await prisma.$transaction([
    prisma.fileAsset.create({
      data: {
        userId: owner,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        url: input.url,
        publicId: input.publicId,
        width: input.width ?? null,
        height: input.height ?? null,
      },
    }),
    prisma.user.update({
      where: { id: owner },
      data: { avatarUrl: input.url },
      select: { id: true, avatarUrl: true },
    }),
  ]);

  // Best-effort remote cleanup; a failure here leaves an orphan, not a bug.
  if (previous?.publicId) {
    void uploadService.destroyAsset(previous.publicId);
    await prisma.fileAsset.delete({ where: { id: previous.id } }).catch(() => undefined);
  }

  res.json({ success: true, data: user });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const owner = userId(req);
  const assetId = req.params.id as string;

  const asset = await prisma.fileAsset.findFirst({
    where: { id: assetId, userId: owner },
    select: { id: true, publicId: true },
  });
  if (!asset) throw new NotFoundError('File');

  if (asset.publicId) void uploadService.destroyAsset(asset.publicId);
  await prisma.fileAsset.delete({ where: { id: asset.id } });

  res.json({ success: true, data: { message: 'File deleted' } });
}

export async function list(req: Request, res: Response): Promise<void> {
  const owner = userId(req);
  const { assignmentId, noteId } = req.query as { assignmentId?: string; noteId?: string };

  if (!assignmentId && !noteId) {
    throw new BadRequestError('Specify assignmentId or noteId');
  }

  const assets = await prisma.fileAsset.findMany({
    where: {
      userId: owner,
      ...(assignmentId ? { assignmentId } : {}),
      ...(noteId ? { noteId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: assets });
}
