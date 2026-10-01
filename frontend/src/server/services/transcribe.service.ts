import 'server-only';
import { env } from '@/server/env';
import { AppError } from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';

/**
 * Groq-hosted Whisper transcription. Groq runs whisper-large-v3-turbo on the
 * same LPU hardware as its chat models — a 20-minute lecture usually comes
 * back in a few seconds and the free tier is generous enough for several
 * lectures per student per day.
 *
 * API shape: multipart POST to /openai/v1/audio/transcriptions with the audio
 * file plus a model id. Response is `{ text: "…" }` for the default format.
 */

export interface TranscribeResult {
  text: string;
  model: string;
  latencyMs: number;
  durationSec?: number;
}

const WHISPER_MODEL = 'whisper-large-v3-turbo';

export async function transcribeAudio(opts: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  language?: string;
  signal?: AbortSignal;
}): Promise<TranscribeResult> {
  if (!env.hasGroq) {
    throw new AppError(
      'Audio transcription requires GROQ_API_KEY — set it in Vercel to enable lecture recording.',
      503,
      'AI_NOT_CONFIGURED',
    );
  }
  if (opts.buffer.byteLength === 0) {
    throw new AppError('Empty audio file.', 400, 'VALIDATION');
  }
  // Groq's upload cap for Whisper is 25 MB. Larger files need to be chunked by
  // the client before upload (ffmpeg or a browser-side chunking step).
  if (opts.buffer.byteLength > 25 * 1024 * 1024) {
    throw new AppError(
      'Audio larger than 25 MB. Record a shorter segment or split the file.',
      413,
      'VALIDATION',
    );
  }

  const started = Date.now();
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(opts.buffer)], { type: opts.mimeType }),
    opts.filename,
  );
  form.append('model', WHISPER_MODEL);
  form.append('response_format', 'verbose_json');
  if (opts.language) form.append('language', opts.language);

  const res = await fetch(`${env.GROQ_BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: form,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    logger.warn(
      { status: res.status, provider: 'groq-whisper' },
      `whisper: HTTP ${res.status}${errText ? ` — ${errText.slice(0, 200)}` : ''}`,
    );
    throw new AppError(
      res.status === 401 || res.status === 403
        ? 'Groq rejected the transcription request. Check GROQ_API_KEY.'
        : res.status === 429
          ? 'Transcription is rate-limited right now. Try again shortly.'
          : 'Transcription failed. Please try again.',
      res.status === 401 || res.status === 403 ? 503 : res.status,
      'AI_UNAVAILABLE',
    );
  }

  const payload = (await res.json()) as { text?: string; duration?: number };
  const text = (payload.text ?? '').trim();
  if (!text) {
    throw new AppError(
      'The audio was too quiet or empty — no speech was detected.',
      422,
      'AI_EMPTY_RESPONSE',
    );
  }

  return {
    text,
    model: WHISPER_MODEL,
    latencyMs: Date.now() - started,
    durationSec: typeof payload.duration === 'number' ? payload.duration : undefined,
  };
}

export const transcribeService = { transcribeAudio };
