import { NextRequest } from 'next/server';
import { z } from 'zod';
import { route, readJson } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { generateFromPrompt } from '@/server/services/gemini.service';

export const maxDuration = 60;

const bodySchema = z.object({
  intent: z.enum(['explain', 'notes', 'quiz']).default('explain'),
  imageBase64: z
    .string()
    .min(100, 'Empty drawing')
    .max(5_000_000, 'Drawing is too large — try clearing sparse strokes'),
});

const PROMPTS: Record<'explain' | 'notes' | 'quiz', string> = {
  explain:
    'Look at this whiteboard image drawn by a student. Interpret what they drew or wrote — ' +
    'formulas, diagrams, mind maps, handwritten notes — and explain it clearly. If it looks ' +
    'like they\'re working through a problem, walk them through the concept step by step.',
  notes:
    'Look at this whiteboard image drawn by a student and turn it into clean study notes. ' +
    'Use headings, bullet points and any formulas you can read. Preserve the structure they ' +
    'were building. Skip anything you can\'t read confidently rather than guessing.',
  quiz:
    'Look at this whiteboard image drawn by a student. Generate 4 short-answer quiz questions ' +
    'that probe the topic they were working on. For each question include the model answer. ' +
    'Number the questions.',
};

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'ai-whiteboard', ...TUTOR_LIMITS.generation });
  const { intent, imageBase64 } = await readJson(req, bodySchema);

  const result = await generateFromPrompt(PROMPTS[intent], {
    tier: 'pro',
    maxOutputTokens: 4096,
    attachments: [{ mimeType: 'image/png', dataBase64: imageBase64 }],
  });

  return ok({ result: result.text, model: result.model, tokens: result.totalTokens });
});
