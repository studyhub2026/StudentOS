import { NextRequest } from 'next/server';
import { z } from 'zod';
import { route, readJson } from '@/server/lib/handler';
import { requireAuth } from '@/server/lib/auth';
import { ok } from '@/server/lib/response';
import { enforceRateLimit, TUTOR_LIMITS } from '@/server/lib/rate-limit';
import { generateText } from '@/server/services/gemini.service';
import type { GeminiMessage, GeminiInlinePart } from '@/server/services/gemini.service';

const bodySchema = z.object({
  message: z.string().min(1).max(5000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'model']),
        content: z.string(),
      }),
    )
    .max(50)
    .default([]),
  documentName: z.string().max(500).default('document'),
  pageContext: z.string().max(2000).optional(),
  selectedText: z.string().max(5000).optional(),
  pdfBase64: z.string().optional(),
  pdfMimeType: z.string().default('application/pdf'),
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth(req);
  enforceRateLimit(user.id, { bucket: 'ai-pdf-chat', ...TUTOR_LIMITS.generation });
  const body = await readJson(req, bodySchema);

  const contextParts: string[] = [];
  if (body.pageContext) contextParts.push(`Current page context: ${body.pageContext}`);
  if (body.selectedText) contextParts.push(`Selected text: "${body.selectedText}"`);

  const systemInstruction = [
    `You are an AI PDF assistant for StudentOS. The student is reading "${body.documentName}".`,
    'Help them understand the document. You can explain concepts, summarize sections, generate study materials, compare pages, find information, and answer questions.',
    'Use Markdown formatting. Be concise but thorough.',
    'If the student selects text, focus your answer on that selection.',
    contextParts.length > 0 ? `\nContext:\n${contextParts.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const messages: GeminiMessage[] = [
    ...body.history,
    { role: 'user', content: body.message },
  ];

  const attachments: GeminiInlinePart[] = [];
  if (body.pdfBase64) {
    attachments.push({
      mimeType: body.pdfMimeType,
      dataBase64: body.pdfBase64,
    });
  }

  const result = await generateText({
    messages,
    systemInstruction,
    attachments,
    maxOutputTokens: 4096,
  });

  return ok({
    reply: result.text,
    model: result.model,
    tokens: result.totalTokens,
  });
});
