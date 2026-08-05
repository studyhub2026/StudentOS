import { NextRequest } from 'next/server';
import { z } from 'zod';
import { AssignmentStatus, Priority } from '@prisma/client';
import { route, readJson } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { generateFromPrompt } from '@/server/services/gemini.service';
import { createNote } from '@/server/services/note.service';
import { createAssignment } from '@/server/services/assignment.service';

const ACTION_PROMPTS: Record<string, (text: string, extra?: string) => string> = {
  explain: (t) =>
    `Explain the following text clearly and concisely. Use simple language. If it contains technical concepts, break them down.\n\nText:\n${t}`,
  summarize: (t) =>
    `Summarize the following text in a concise paragraph. Keep the key points.\n\nText:\n${t}`,
  rewrite: (t) =>
    `Rewrite the following text to be clearer and more professional while keeping the same meaning.\n\nText:\n${t}`,
  simplify: (t) =>
    `Rewrite the following text in the simplest possible language a beginner could understand. Prefer short sentences, everyday words, and a friendly tone. Preserve meaning.\n\nText:\n${t}`,
  shorten: (t) =>
    `Shorten the following text significantly while keeping the essential meaning.\n\nText:\n${t}`,
  expand: (t) =>
    `Expand the following text with more detail, examples, and explanation.\n\nText:\n${t}`,
  improve: (t) =>
    `Improve the writing quality of the following text. Fix any issues with clarity, flow, and style.\n\nText:\n${t}`,
  fix_grammar: (t) =>
    `Fix all grammar, spelling, and punctuation errors in the following text. Return only the corrected text.\n\nText:\n${t}`,
  translate: (t, lang) =>
    `Translate the following text to ${lang ?? 'English'}. Return only the translation.\n\nText:\n${t}`,
  generate_quiz: (t) =>
    `Generate 5 multiple-choice quiz questions based on the following text. For each question provide 4 options and mark the correct answer. Format as numbered list.\n\nText:\n${t}`,
  generate_flashcards: (t) =>
    `Generate 5 flashcards from the following text. Each flashcard should have a Front (question/term) and Back (answer/definition). Format clearly.\n\nText:\n${t}`,
  generate_notes: (t) =>
    `Generate concise study notes from the following text. Use bullet points, highlight key terms, and organize by topic.\n\nText:\n${t}`,
  ask_ai: (t, question) =>
    `Based on the following text, answer this question: ${question ?? 'What is this about?'}\n\nText:\n${t}`,
};

const bodySchema = z.object({
  action: z.string().min(1),
  text: z.string().min(1).max(10000),
  extra: z.string().max(500).optional(),
});

function firstLine(text: string, max = 80): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : line.slice(0, max - 1).trimEnd() + '…';
}

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'ai-actions', ...TUTOR_LIMITS.generation });
  const { action, text, extra } = await readJson(req, bodySchema);

  // Persistence actions live outside the Gemini action set. They reuse the
  // real create endpoints via their services so validation, ownership checks
  // and side effects (excerpts, word counts, etc.) all fire.
  if (action === 'save_as_note') {
    const title = extra?.trim() || firstLine(text);
    const note = await createNote(user.id, {
      title,
      content: text,
      tags: ['from-selection'],
    });
    return ok({
      result: `Saved as note "${note.title}".`,
      savedType: 'note',
      savedId: note.id,
      savedUrl: '/notes',
    });
  }

  if (action === 'save_as_assignment') {
    const title = extra?.trim() || firstLine(text);
    const assignment = await createAssignment(user.id, {
      title,
      description: text,
      status: AssignmentStatus.TODO,
      priority: Priority.MEDIUM,
      labels: ['from-selection'],
    });
    return ok({
      result: `Saved as assignment "${assignment.title}".`,
      savedType: 'assignment',
      savedId: assignment.id,
      savedUrl: '/assignments',
    });
  }

  const promptFn = ACTION_PROMPTS[action];
  if (!promptFn) {
    return ok({ result: 'Unknown action' }, 400);
  }

  const prompt = promptFn(text, extra);
  const result = await generateFromPrompt(prompt, {
    systemInstruction:
      'You are a helpful AI assistant for students. Respond clearly and concisely. Use Markdown formatting when appropriate.',
    maxOutputTokens: 4096,
  });

  return ok({ result: result.text, model: result.model, tokens: result.totalTokens });
});
