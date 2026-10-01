import 'server-only';
import { z } from 'zod';
import { CardDifficulty } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { resolveProvider } from '@/server/ai/router';
import { createNote } from './note.service';
import { createDeck, createCards } from './flashcard.service';

/**
 * Lecture ingestion pipeline. Takes a raw Whisper transcript and converts it
 * into the study artefacts a student actually uses: a titled note with
 * sectioned bullet summary, plus a flashcard deck seeded from the key facts.
 *
 * Runs the AI step as a single structured-JSON call so we persist exactly
 * one piece of generated content. Gemini is preferred for the JSON step
 * because it is more reliable at honouring response schemas than the fast
 * chat models — latency here is less important than correctness.
 */

export interface ProcessLectureInput {
  transcript: string;
  subjectId?: string;
  /** Optional title the student typed before recording. The AI will prefer it. */
  titleHint?: string;
  durationSec?: number;
}

export interface ProcessLectureResult {
  noteId: string;
  deckId: string | null;
  title: string;
  cardCount: number;
  summary: string;
}

const lectureSchema = z.object({
  title: z.string().trim().min(3).max(140),
  summary: z.string().trim().min(10).max(600),
  bulletPoints: z
    .array(z.string().trim().min(2).max(300))
    .min(3)
    .max(30),
  flashcards: z
    .array(
      z.object({
        front: z.string().trim().min(3).max(240),
        back: z.string().trim().min(1).max(600),
      }),
    )
    .max(20)
    .default([]),
  tags: z.array(z.string().trim().min(1).max(32)).max(8).default([]),
});

type ParsedLecture = z.infer<typeof lectureSchema>;

const LECTURE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    bulletPoints: { type: 'array', items: { type: 'string' } },
    flashcards: {
      type: 'array',
      items: {
        type: 'object',
        properties: { front: { type: 'string' }, back: { type: 'string' } },
        required: ['front', 'back'],
      },
    },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'summary', 'bulletPoints', 'flashcards'],
} as const;

export async function processLecture(
  userId: string,
  input: ProcessLectureInput,
): Promise<ProcessLectureResult> {
  const transcript = input.transcript.trim();
  if (transcript.length < 60) {
    throw new AppError(
      'The transcript is too short to turn into study notes. Record at least a minute of audio.',
      400,
      'VALIDATION',
    );
  }

  // Cap what we send to the model. 25k chars is roughly a 20-minute lecture
  // in English. For longer lectures we truncate — later we can chunk + merge
  // but that is a day-two feature.
  const bounded = transcript.length > 25_000 ? transcript.slice(0, 25_000) : transcript;

  const provider = resolveProvider({ task: 'json' });
  const titleHint = input.titleHint?.trim();

  const systemInstruction = [
    'You turn a raw lecture transcript into study material for a university student.',
    'Produce ONE JSON object matching the schema. Nothing else.',
    'The title must capture the lecture topic in 3–10 words. If a title hint is provided, prefer it unless it is obviously wrong.',
    'The summary is 2–3 complete sentences that cover what the lecture actually covered — avoid filler like "this lecture discusses".',
    'bulletPoints: 5–15 crisp bullets ordered the way the lecture unfolded. Each bullet stands alone and preserves specific terms, numbers, formulas and named entities exactly as the lecturer used them.',
    'flashcards: 6–15 cards drawn from the most testable facts. Front is a specific question — not "What is this about?". Back is the answer in one or two sentences. Draw ONLY from the transcript — never invent material.',
    'tags: up to 5 lowercase, single-word topic tags.',
    'If the transcript has long dead air, repeated filler ("um", "uh") or looks like it was mostly background noise, still produce the best study material you can from the usable content.',
  ].join(' ');

  const parsed = await (async (): Promise<ParsedLecture> => {
    try {
      const result = await provider.generateJson({
        systemInstruction,
        responseSchema: LECTURE_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        parse: (raw) => lectureSchema.parse(raw),
        messages: [
          {
            role: 'user',
            content: [
              titleHint ? `Title hint from the student: "${titleHint}".` : '',
              input.durationSec
                ? `Recorded duration: ${Math.round(input.durationSec / 60)} minutes.`
                : '',
              'Transcript:',
              bounded,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
        temperature: 0.4,
        maxOutputTokens: 4096,
      });
      return result.data;
    } catch (err) {
      logger.warn({ err, userId }, 'lecture: AI processing failed');
      throw err instanceof AppError
        ? err
        : new AppError('The AI could not process this lecture. Try again.', 502, 'AI_UNAVAILABLE');
    }
  })();

  // Build the note body as markdown — plays nicely with the existing note
  // editor and renderer.
  const noteBody = buildNoteBody(parsed, { durationSec: input.durationSec });

  const note = await createNote(userId, {
    title: titleHint || parsed.title,
    content: noteBody,
    contentJson: null,
    tags: Array.from(new Set([...parsed.tags, 'lecture'])),
    folderId: undefined,
    subjectId: input.subjectId,
    pinned: false,
    favorite: false,
  });

  // Only create a deck when the model actually produced cards.
  let deckId: string | null = null;
  let cardCount = 0;
  if (parsed.flashcards.length > 0) {
    const deck = await createDeck(userId, {
      name: `${titleHint || parsed.title} — Flashcards`,
      description: `Auto-generated from a recorded lecture on ${new Date().toLocaleDateString()}`,
      color: '#8b5cf6',
      subjectId: input.subjectId,
      sourceNoteId: note.id,
      isPublic: false,
      generatedByAi: true,
    });
    deckId = deck.id;
    cardCount = await createCards(
      userId,
      deck.id,
      parsed.flashcards.map((c) => ({
        front: c.front,
        back: c.back,
        difficulty: CardDifficulty.MEDIUM,
        tags: [],
        generatedByAi: true,
      })),
    );
  }

  // Persist the raw transcript for later reference / re-processing. We stash
  // it on the note's wordCount-adjacent metadata via a dedicated LectureSource
  // model would be cleaner, but keeping it in the note's own storage avoids a
  // schema migration for v1.
  await prisma.note.update({
    where: { id: note.id },
    data: {
      content: `${noteBody}\n\n---\n\n## Full transcript\n\n${transcript}`,
    },
  });

  return {
    noteId: note.id,
    deckId,
    title: titleHint || parsed.title,
    cardCount,
    summary: parsed.summary,
  };
}

function buildNoteBody(p: ParsedLecture, opts: { durationSec?: number }): string {
  const parts: string[] = [];
  if (opts.durationSec) {
    const min = Math.round(opts.durationSec / 60);
    parts.push(`_Recorded lecture · ${min} min · auto-transcribed_`);
  } else {
    parts.push('_Recorded lecture · auto-transcribed_');
  }
  parts.push('');
  parts.push('## Summary');
  parts.push(p.summary);
  parts.push('');
  parts.push('## Key points');
  for (const b of p.bulletPoints) parts.push(`- ${b}`);
  if (p.flashcards.length > 0) {
    parts.push('');
    parts.push(`_${p.flashcards.length} flashcards generated — see the Flashcards tab._`);
  }
  return parts.join('\n');
}

export const lectureService = { processLecture };
