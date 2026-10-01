export const maxDuration = 60;
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/lib/auth';
import { readJson, route } from '@/server/lib/handler';
import { created } from '@/server/lib/response';
import { BadRequestError, NotFoundError } from '@/server/lib/errors';
import { prisma } from '@/server/db';
import { generateMindMapFromPrompt } from '@/server/services/mind-map-ai.service';

/**
 * POST /api/v1/mind-maps/generate-from-file
 *
 * Starts a brand-new mind map from a single course file — the file the
 * student is already looking at inside the Course Files panel. The id can
 * be either a manual upload (FileAsset) or an LMS-mirrored row prefixed
 * with `lms:` the way the uploads endpoint projects them.
 *
 * LMS files that finished ingestion carry a KnowledgeDocument link, so we
 * forward that as a documentIds seed to the existing generation pipeline
 * — the AI gets the full extracted text, not just the filename. For every
 * other case we fall back to a filename-derived prompt so the student can
 * still kick off a map while the Knowledge Base is catching up.
 */
const schema = z.object({
  fileId: z.string().min(1).max(80),
  prompt: z.string().min(2).max(2000).optional(),
  depth: z.enum(['shallow', 'normal', 'deep']).optional(),
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  const { fileId, prompt, depth } = await readJson(req, schema);

  let documentId: string | undefined;
  let filename = 'this document';
  let subjectId: string | undefined;

  if (fileId.startsWith('lms:')) {
    const lmsFileId = fileId.slice(4);
    const f = await prisma.lmsFile.findFirst({
      where: { id: lmsFileId, userId: user.id },
      select: {
        id: true,
        filename: true,
        knowledgeDocumentId: true,
        course: { select: { localSubjectId: true } },
      },
    });
    if (!f) throw new NotFoundError('File');
    filename = f.filename;
    documentId = f.knowledgeDocumentId ?? undefined;
    subjectId = f.course.localSubjectId ?? undefined;
  } else {
    const asset = await prisma.fileAsset.findFirst({
      where: { id: fileId, userId: user.id },
      select: { id: true, filename: true, subjectId: true },
    });
    if (!asset) throw new NotFoundError('File');
    filename = asset.filename;
    subjectId = asset.subjectId ?? undefined;
  }

  const effectivePrompt =
    prompt?.trim() ||
    `Build a comprehensive mind map covering the key concepts, sections, and ideas in "${filename}". Group related topics into branches so a student can study from the hierarchy alone.`;

  if (!documentId && !subjectId) {
    // Nothing to ground the generation beyond the filename itself — still
    // let the AI run so the student gets *something*, but surface a hint
    // in the server reply so the UI can show a soft warning.
  }

  try {
    const { mapId } = await generateMindMapFromPrompt(user.id, {
      prompt: effectivePrompt,
      depth: depth ?? 'normal',
      ...(documentId ? { documentIds: [documentId] } : {}),
      ...(subjectId ? { subjectId, includeCourseContext: true } : {}),
    });
    return created({ id: mapId, grounded: Boolean(documentId) });
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new BadRequestError('Mind map generation failed. Please try again.');
  }
});
