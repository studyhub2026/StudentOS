import 'server-only';
import { env } from '@/server/env';
import { AppError } from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import type {
  AiJsonRequest,
  AiJsonResult,
  AiMessage,
  AiProvider,
  AiStreamGenerator,
  AiTextRequest,
} from './provider';

/**
 * Groq adapter — talks to Groq's OpenAI-compatible `/chat/completions` surface
 * at api.groq.com. Groq runs open-weight models (Llama 3.x, Mixtral, Gemma)
 * on custom LPU hardware and routinely returns in a few hundred milliseconds
 * — about an order of magnitude faster than Gemini or DeepSeek for the same
 * prompt. Picked here because it has a free tier that is generous enough to
 * cover a classroom's worth of students, and because its latency transforms
 * the feel of chat and mind-map generation.
 *
 * Auth: Bearer GROQ_API_KEY (server-only, never shipped to the client).
 * Streaming: SSE with `data:` frames; final frame is the string `[DONE]`.
 * JSON mode: response_format = { type: 'json_object' } — Zod at the caller
 * still has the final say via request.parse().
 *
 * Same retry envelope as the other providers (429 + 5xx, capped attempts,
 * jitter) with a shorter backoff since Groq is quick enough that long waits
 * usually mean the request itself is dead, not slow.
 */

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

interface GroqMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface GroqUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface GroqCompletion {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string | null;
  }>;
  usage?: GroqUsage;
}

interface GroqStreamChunk {
  choices: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
  usage?: GroqUsage;
  model?: string;
}

function ensureConfigured() {
  if (!env.hasGroq) {
    throw new AppError(
      'Groq is unavailable because GROQ_API_KEY is not configured.',
      503,
      'AI_NOT_CONFIGURED',
    );
  }
}

function pickModel(tier: AiTextRequest['tier']): string {
  // 'pro' => the 70B general-purpose model if configured, otherwise fall back
  // to the fast one so a half-configured deployment still responds.
  if (tier === 'pro') return env.GROQ_PRO_MODEL || env.GROQ_DEFAULT_MODEL;
  return env.GROQ_DEFAULT_MODEL;
}

function toGroqMessages(messages: AiMessage[], systemInstruction?: string): GroqMessage[] {
  const out: GroqMessage[] = [];
  if (systemInstruction) out.push({ role: 'system', content: systemInstruction });
  for (const m of messages) out.push({ role: m.role, content: m.content });
  return out;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new AppError('Aborted', 499, 'AI_ABORTED'));
    });
  });
}

async function callWithRetry(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  let attempt = 0;
  let lastErr: unknown;
  while (attempt < MAX_ATTEMPTS) {
    try {
      const res = await fetch(`${env.GROQ_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
      if (res.ok) return res;
      if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS - 1) {
        const text = await res.text().catch(() => '');
        logger.warn(
          { status: res.status, provider: 'groq', path },
          `groq: non-retryable HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`,
        );
        throw new AppError(
          res.status === 401 || res.status === 403
            ? 'Groq rejected the request. Check GROQ_API_KEY.'
            : res.status === 429
              ? 'AI service is rate-limited. Please try again shortly.'
              : 'The AI service is temporarily unavailable.',
          res.status === 401 || res.status === 403 ? 503 : res.status,
          res.status === 401 || res.status === 403 ? 'AI_NOT_CONFIGURED' : 'AI_UNAVAILABLE',
        );
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (err instanceof AppError) throw err;
      lastErr = err;
    }
    const wait = BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 150;
    await delay(wait, signal);
    attempt++;
  }
  logger.error({ err: lastErr, provider: 'groq', path }, 'groq retries exhausted');
  throw new AppError('The AI service is temporarily unavailable.', 503, 'AI_UNAVAILABLE');
}

async function nonStreamingCompletion(request: AiTextRequest, jsonMode: boolean): Promise<{
  text: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason: string | null;
  latencyMs: number;
}> {
  ensureConfigured();
  const started = Date.now();
  const model = pickModel(request.tier);
  const body: Record<string, unknown> = {
    model,
    messages: toGroqMessages(request.messages, request.systemInstruction),
    temperature: request.temperature ?? 0.7,
    max_tokens: request.maxOutputTokens ?? 4096,
    stream: false,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const res = await callWithRetry('/chat/completions', body, request.signal);
  const payload = (await res.json()) as GroqCompletion;
  const choice = payload.choices?.[0];
  const text = choice?.message?.content ?? '';
  if (!text.trim()) {
    throw new AppError('Groq returned an empty response.', 422, 'AI_EMPTY_RESPONSE');
  }
  return {
    text,
    model: payload.model ?? model,
    usage: {
      promptTokens: payload.usage?.prompt_tokens ?? 0,
      completionTokens: payload.usage?.completion_tokens ?? 0,
      totalTokens: payload.usage?.total_tokens ?? 0,
    },
    finishReason: choice?.finish_reason ?? null,
    latencyMs: Date.now() - started,
  };
}

async function* parseSseStream(res: Response): AsyncGenerator<GroqStreamChunk> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            yield JSON.parse(data) as GroqStreamChunk;
          } catch {
            // ignore malformed frame — Groq occasionally emits keep-alive pings
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const groqProvider: AiProvider = {
  id: 'groq',
  isConfigured: () => env.hasGroq,

  async generateText(request) {
    const r = await nonStreamingCompletion(request, false);
    return { provider: 'groq', ...r };
  },

  async generateJson<T>(request: AiJsonRequest<T>): Promise<AiJsonResult<T>> {
    const r = await nonStreamingCompletion(request, true);
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(r.text);
    } catch {
      // Some fast models still slip in markdown fences around JSON; strip
      // them before giving up.
      const stripped = r.text
        .replace(/^```(?:json)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();
      try {
        parsedRaw = JSON.parse(stripped);
      } catch {
        throw new AppError('Groq returned malformed JSON.', 502, 'AI_INVALID_RESPONSE');
      }
    }
    const data = request.parse(parsedRaw);
    return { provider: 'groq', ...r, data, raw: r.text };
  },

  streamText(request: AiTextRequest): AiStreamGenerator {
    return (async function* () {
      ensureConfigured();
      const started = Date.now();
      const model = pickModel(request.tier);
      const res = await callWithRetry(
        '/chat/completions',
        {
          model,
          messages: toGroqMessages(request.messages, request.systemInstruction),
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxOutputTokens ?? 4096,
          stream: true,
          stream_options: { include_usage: true },
        },
        request.signal,
      );

      let accumulated = '';
      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;
      let finishReason: string | null = null;
      let resolvedModel = model;

      for await (const chunk of parseSseStream(res)) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          accumulated += delta;
          yield delta;
        }
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
          completionTokens = chunk.usage.completion_tokens ?? completionTokens;
          totalTokens = chunk.usage.total_tokens ?? totalTokens;
        }
        if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
        if (chunk.model) resolvedModel = chunk.model;
      }

      if (!accumulated.trim()) {
        throw new AppError(
          'Groq returned an empty response. Try rephrasing your prompt.',
          422,
          'AI_EMPTY_RESPONSE',
        );
      }

      return {
        provider: 'groq',
        model: resolvedModel,
        text: accumulated,
        usage: { promptTokens, completionTokens, totalTokens },
        latencyMs: Date.now() - started,
        finishReason,
      };
    })();
  },
};
