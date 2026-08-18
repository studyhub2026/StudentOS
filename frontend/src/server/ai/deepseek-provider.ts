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
 * DeepSeek adapter — implemented against the OpenAI-compatible `/chat/completions`
 * surface DeepSeek publishes at api.deepseek.com. Chosen over the openai SDK
 * to avoid a 100 KB+ dependency for what fits in ~200 lines of typed fetch.
 *
 * Auth: Bearer DEEPSEEK_API_KEY (server-only, never returned to the client).
 * Streaming: SSE with `data:` frames; final frame is the string `[DONE]`.
 * JSON mode: response_format = { type: 'json_object' } — Zod at the caller
 * still has the final say via request.parse().
 *
 * Same retry envelope as gemini.service (429 + 5xx, capped attempts, jitter).
 */

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

interface DsMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface DsUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface DsCompletion {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string | null;
  }>;
  usage?: DsUsage;
}

interface DsStreamChunk {
  choices: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
  usage?: DsUsage;
  model?: string;
}

function ensureConfigured() {
  if (!env.hasDeepSeek) {
    throw new AppError(
      'DeepSeek is unavailable because DEEPSEEK_API_KEY is not configured.',
      503,
      'AI_NOT_CONFIGURED',
    );
  }
}

function pickModel(tier: AiTextRequest['tier']): string {
  // pro/reasoning => deepseek-reasoner if configured, else the default chat
  // model still works (reasoner is optional).
  if (tier === 'pro') return env.DEEPSEEK_REASONING_MODEL || env.DEEPSEEK_DEFAULT_MODEL;
  return env.DEEPSEEK_DEFAULT_MODEL;
}

function toDsMessages(messages: AiMessage[], systemInstruction?: string): DsMessage[] {
  const out: DsMessage[] = [];
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
      const res = await fetch(`${env.DEEPSEEK_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
      if (res.ok) return res;
      if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS - 1) {
        const text = await res.text().catch(() => '');
        // Never log the request body (contains user prompts).
        logger.warn(
          { status: res.status, provider: 'deepseek', path },
          `deepseek: non-retryable HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`,
        );
        throw new AppError(
          res.status === 401 || res.status === 403
            ? 'DeepSeek rejected the request. Check DEEPSEEK_API_KEY.'
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
    const wait = BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 200;
    await delay(wait, signal);
    attempt++;
  }
  logger.error({ err: lastErr, provider: 'deepseek', path }, 'deepseek retries exhausted');
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
    messages: toDsMessages(request.messages, request.systemInstruction),
    temperature: request.temperature ?? 0.7,
    max_tokens: request.maxOutputTokens ?? 4096,
    stream: false,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const res = await callWithRetry('/chat/completions', body, request.signal);
  const payload = (await res.json()) as DsCompletion;
  const choice = payload.choices?.[0];
  const text = choice?.message?.content ?? '';
  if (!text.trim()) {
    throw new AppError('DeepSeek returned an empty response.', 422, 'AI_EMPTY_RESPONSE');
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

async function* parseSseStream(res: Response): AsyncGenerator<DsStreamChunk> {
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
            yield JSON.parse(data) as DsStreamChunk;
          } catch {
            // ignore malformed frame — DeepSeek occasionally emits pings
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const deepseekProvider: AiProvider = {
  id: 'deepseek',
  isConfigured: () => env.hasDeepSeek,

  async generateText(request) {
    const r = await nonStreamingCompletion(request, false);
    return { provider: 'deepseek', ...r };
  },

  async generateJson<T>(request: AiJsonRequest<T>): Promise<AiJsonResult<T>> {
    const r = await nonStreamingCompletion(request, true);
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(r.text);
    } catch {
      const stripped = r.text
        .replace(/^```(?:json)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();
      try {
        parsedRaw = JSON.parse(stripped);
      } catch {
        throw new AppError('DeepSeek returned malformed JSON.', 502, 'AI_INVALID_RESPONSE');
      }
    }
    const data = request.parse(parsedRaw); // Zod validates downstream
    return { provider: 'deepseek', ...r, data, raw: r.text };
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
          messages: toDsMessages(request.messages, request.systemInstruction),
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxOutputTokens ?? 4096,
          stream: true,
          // Ask the API to include usage on the final chunk so callers see
          // real token accounting rather than zeros.
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
          'DeepSeek returned an empty response. Try rephrasing your prompt.',
          422,
          'AI_EMPTY_RESPONSE',
        );
      }

      return {
        provider: 'deepseek',
        model: resolvedModel,
        text: accumulated,
        usage: { promptTokens, completionTokens, totalTokens },
        latencyMs: Date.now() - started,
        finishReason,
      };
    })();
  },
};
