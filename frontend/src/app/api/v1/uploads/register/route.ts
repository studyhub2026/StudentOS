import type { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireAuth } from '@/server/lib/auth';
import { NotFoundError } from '@/server/lib/errors';
import { readJson, route } from '@/server/lib/handler';
import { created } from '@/server/lib/response';
import { uploadService, type UploadFolder } from '@/server/services/upload.service';
import { noteService } from '@/server/services/note.service';
import { groupService } from '@/server/services/group.service';
import { registerUploadSchema } from '@/server/validators/upload.validator';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const input = await readJson(req, registerUploadSchema);

  uploadService.validateUploadResult(user.id, input.folder as UploadFolder, {
    publicId: input.publicId, url: input.url, bytes: input.sizeBytes, format: input.format,
  });

  if (input.assignmentId) {
    const a = await prisma.assignment.findFirst({ where: { id: input.assignmentId, userId: user.id, deletedAt: null }, select: { id: true } });
    if (!a) throw new NotFoundError('Assignment');
  }
  if (input.noteId) await noteService.assertCanAccess(user.id, input.noteId, 'write');
  if (input.messageId) {
    const m = await prisma.message.findFirst({ where: { id: input.messageId, authorId: user.id }, select: { id: true, channel: { select: { groupId: true } } } });
    if (!m) throw new NotFoundError('Message');
    if (m.channel.groupId) await groupService.requireMembership(user.id, m.channel.groupId);
  }

  const asset = await prisma.fileAsset.create({
    data: {
      userId: user.id, filename: input.filename, mimeType: input.mimeType, sizeBytes: input.sizeBytes,
      url: input.url, publicId: input.publicId, width: input.width ?? null, height: input.height ?? null,
      assignmentId: input.assignmentId ?? null, noteId: input.noteId ?? null, messageId: input.messageId ?? null,
    },
  });
  return created(asset);
});
