import type { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { uploadService } from '@/server/services/upload.service';
import { registerUploadSchema } from '@/server/validators/upload.validator';

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const input = await readJson(req, registerUploadSchema);

  uploadService.validateUploadResult(user.id, 'avatars', {
    publicId: input.publicId, url: input.url, bytes: input.sizeBytes, format: input.format,
  });

  const previous = await prisma.fileAsset.findFirst({
    where: { userId: user.id, publicId: { startsWith: `studentos/avatars/${user.id}/` } },
    orderBy: { createdAt: 'desc' }, select: { id: true, publicId: true },
  });

  const [, updated] = await prisma.$transaction([
    prisma.fileAsset.create({
      data: { userId: user.id, filename: input.filename, mimeType: input.mimeType, sizeBytes: input.sizeBytes, url: input.url, publicId: input.publicId, width: input.width ?? null, height: input.height ?? null },
    }),
    prisma.user.update({ where: { id: user.id }, data: { avatarUrl: input.url }, select: { id: true, avatarUrl: true } }),
  ]);

  if (previous?.publicId) {
    void uploadService.destroyAsset(previous.publicId);
    await prisma.fileAsset.delete({ where: { id: previous.id } }).catch(() => undefined);
  }
  return ok(updated);
});
