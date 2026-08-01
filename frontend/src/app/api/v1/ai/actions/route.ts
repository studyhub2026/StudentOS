import { NextRequest } from 'next/server';
import { z } from 'zod';
import { route, readJson } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok } from '@/server/lib/response';
import { generateFromPrompt } from '@/server/services/gemini.service';

const ACTION_PROMPTS: Record<string, (text: string, extra?: string) => string> = {
  explain: (t) =>
    `Explain the following text clearly and concisely. Use simple language. If it contains technical concepts, break them down.\n\nText:\n${t}`,
  summarize: (t) =>
    `Summarize the following text in a concise paragraph. Keep the key points.\n\nText:\n${t}`,
  rewrite: (t) =>
    `Rewrite the following text to be clearer and more professional while keeping the same meaning.\n\nText:\n${t}`,
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

export const POST = route(async (req: NextRequest) => {
  await requireAuth(req);
  const { action, text, extra } = await readJson(req, bodySchema);

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
