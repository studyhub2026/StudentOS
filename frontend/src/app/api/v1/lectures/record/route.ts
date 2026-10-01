export const runtime = 'nodejs';
export const maxDuration = 60;
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { AppError } from '@/server/lib/errors';
import { transcribeAudio } from '@/server/services/transcribe.service';
import { processLecture } from '@/server/services/lecture.service';

/**
 * POST /api/v1/lectures/record
 *
 * One-shot lecture ingestion. The client posts a multipart body with:
 *   - audio: a Blob (webm/opus from MediaRecorder, or any file Whisper accepts)
 *   - subjectId (optional)
 *   - titleHint (optional, 1-140 chars) — the user's typed title before record
 *   - durationSec (optional) — recorded length so the summary can mention it
 *
 * Server runs Groq Whisper for the transcript, then the lecture service for
 * title/summary/bullets/flashcards, and persists a Note + optional Deck. The
 * response includes the ids so the client can navigate straight into the
 * generated artefacts.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);

  const form = await req.formData().catch(() => {
    throw new AppError('Expected multipart/form-data with an "audio" field.', 400, 'VALIDATION');
  });

  const audio = form.get('audio');
  if (!(audio instanceof Blob)) {
    throw new AppError('Missing "audio" file.', 400, 'VALIDATION');
  }

  const subjectId = toOptionalString(form.get('subjectId'));
  const titleHint = toOptionalString(form.get('titleHint'));
  const durationRaw = toOptionalString(form.get('durationSec'));
  const durationSec = durationRaw ? Number(durationRaw) : undefined;

  const mimeType = audio.type || 'audio/webm';
  const buffer = Buffer.from(await audio.arrayBuffer());
  const filename = (audio as File).name || `lecture-${Date.now()}.webm`;

  const transcription = await transcribeAudio({
    buffer,
    filename,
    mimeType,
  });

  const processed = await processLecture(user.id, {
    transcript: transcription.text,
    subjectId,
    titleHint,
    durationSec: Number.isFinite(durationSec) ? durationSec : transcription.durationSec,
  });

  return ok({
    ...processed,
    transcriptLength: transcription.text.length,
    whisperModel: transcription.model,
    transcriptionMs: transcription.latencyMs,
  });
});

function toOptionalString(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
