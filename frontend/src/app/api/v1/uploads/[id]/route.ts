import type { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireAuth } from '@/server/lib/auth';
import { NotFoundError } from '@/server/lib/errors';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { uploadService } from '@/server/services/upload.service';

export const DELETE = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const user = await requireAuth(req);
  const asset = await prisma.fileAsset.findFirst({ where: { id: params.id, userId: user.id }, select: { id: true, publicId: true } });
  if (!asset) throw new NotFoundError('File');
  if (asset.publicId) void uploadService.destroyAsset(asset.publicId);
  await prisma.fileAsset.delete({ where: { id: asset.id } });
  return ok({ message: 'File deleted' });
});
