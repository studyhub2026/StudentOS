import 'server-only';
import * as gemini from '@/server/services/gemini.service';
import { env } from '@/server/env';
import type {
  AiJsonRequest,
  AiJsonResult,
  AiProvider,
  AiStreamGenerator,
  AiTextRequest,
  AiTextResult,
} from './provider';

/**
 * Thin adapter that presents `gemini.service` as an `AiProvider`. All the
 * heavy lifting — retries, safety config, token accounting, model selection,
 * PDF/image attachments — stays where it already lives; this file only maps
 * between the abstract shape and Gemini's native calls so no consumer needs
 * to know which model is behind them.
 */

function toGeminiMessages(messages: AiTextRequest['messages']) {
  // The provider interface uses OpenAI-style roles (user/assistant/system);
  // gemini.service takes user/model with a separate systemInstruction. We map
  // "assistant" to "model" and hoist the last system message to the config
  // above the messages array (Gemini forbids interleaved system turns).
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      content: m.content,
    }));
}

function pickSystem(request: AiTextRequest): string | undefined {
  if (request.systemInstruction) return request.systemInstruction;
  const sys = request.messages.filter((m) => m.role === 'system').map((m) => m.content);
  return sys.length > 0 ? sys.join('\n\n') : undefined;
}

export const geminiProvider: AiProvider = {
  id: 'gemini',
  isConfigured: () => env.hasGemini,

  async generateText(request: AiTextRequest): Promise<AiTextResult> {
    const result = await gemini.generateText({
      messages: toGeminiMessages(request.messages),
      ...(pickSystem(request) ? { systemInstruction: pickSystem(request)! } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.attachments ? { attachments: request.attachments } : {}),
      ...(request.tier ? { tier: request.tier } : {}),
    });
    return {
      provider: 'gemini',
      model: result.model,
      text: result.text,
      usage: {
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
      },
      latencyMs: result.latencyMs,
      finishReason: result.finishReason,
    };
  },

  async generateJson<T>(request: AiJsonRequest<T>): Promise<AiJsonResult<T>> {
    if (!request.responseSchema) {
      throw new Error('geminiProvider.generateJson requires responseSchema');
    }
    const result = await gemini.generateJson<T>({
      messages: toGeminiMessages(request.messages),
      ...(pickSystem(request) ? { systemInstruction: pickSystem(request)! } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.tier ? { tier: request.tier } : {}),
      responseSchema: request.responseSchema,
      parse: request.parse,
    });
    return {
      provider: 'gemini',
      model: result.model,
      data: result.data,
      raw: result.raw,
      usage: {
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
      },
      latencyMs: result.latencyMs,
      finishReason: result.finishReason,
    };
  },

  streamText(request: AiTextRequest): AiStreamGenerator {
    return (async function* () {
      const source = gemini.streamText({
        messages: toGeminiMessages(request.messages),
        ...(pickSystem(request) ? { systemInstruction: pickSystem(request)! } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.attachments ? { attachments: request.attachments } : {}),
        ...(request.tier ? { tier: request.tier } : {}),
      });
      let final: Awaited<ReturnType<typeof source.next>>;
      while (!(final = await source.next()).done) {
        yield final.value;
      }
      const done = final.value;
      const result: AiTextResult = {
        provider: 'gemini',
        model: done.model,
        text: done.text,
        usage: {
          promptTokens: done.promptTokens,
          completionTokens: done.completionTokens,
          totalTokens: done.totalTokens,
        },
        latencyMs: done.latencyMs,
        finishReason: done.finishReason,
      };
      return result;
    })();
  },
};
