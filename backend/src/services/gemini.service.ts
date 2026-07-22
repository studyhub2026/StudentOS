import { GoogleGenAI, type Content, type GenerateContentResponse } from '@google/genai';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/errors.js';

/**
 * The single Gemini integration point for the entire platform.
 *
 * Every AI feature — chat, homework help, planning, quiz and flashcard
 * generation, summarising — routes through this service. No controller may
 * construct its own client, so retries, safety settings, token accounting and
 * model selection stay consistent in one place.
 */

export type GeminiTier = 'flash' | 'pro';

export interface GeminiMessage {
  role: 'user' | 'model';
  content: string;
}

export interface GeminiRequest {
  /** Ordered conversation turns. The last entry should be the user's prompt. */
  messages: GeminiMessage[];
  /** Steers behaviour and persona; not part of the visible transcript. */
  systemInstruction?: string;
  tier?: GeminiTier;
  temperature?: number;
  maxOutputTokens?: number;
  /** Abort in-flight generation when the client disconnects. */
  signal?: AbortSignal;
}

export interface GeminiResult {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  finishReason: string | null;
}

/** A JSON-mode result, parsed and validated by the caller's schema. */
export interface GeminiJsonResult<T> extends Omit<GeminiResult, 'text'> {
  data: T;
  raw: string;
}

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;
/** Status codes worth retrying: rate limits and transient server faults. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!env.hasGemini) {
    throw new AppError(
      'AI features are unavailable because GEMINI_API_KEY is not configured.',
      503,
      'AI_NOT_CONFIGURED',
    );
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY as string });
  }
  return client;
}

function resolveModel(tier: GeminiTier = 'flash'): string {
  return tier === 'pro' ? env.GEMINI_PRO_MODEL : env.GEMINI_DEFAULT_MODEL;
}

function toContents(messages: GeminiMessage[]): Content[] {
  return messages.map((message) => ({
    role: message.role,
    parts: [{ text: message.content }],
  }));
}

function extractStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { status?: unknown; code?: unknown };
  if (typeof candidate.status === 'number') return candidate.status;
  if (typeof candidate.code === 'number') return candidate.code;
  return null;
}

function isRetryable(error: unknown): boolean {
  const status = extractStatus(error);
  if (status !== null) return RETRYABLE_STATUS.has(status);
  // Network-level faults surface as plain Errors with no status.
  return error instanceof Error && /fetch|network|timeout|ECONN/i.test(error.message);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function toResult(
  response: GenerateContentResponse,
  model: string,
  latencyMs: number,
): GeminiResult {
  const usage = response.usageMetadata;
  const finishReason = response.candidates?.[0]?.finishReason ?? null;
  const text = response.text ?? '';

  if (!text.trim()) {
    // An empty body almost always means a safety block, which the caller
    // should surface to the student rather than rendering a blank bubble.
    const blockReason = response.promptFeedback?.blockReason;
    throw new AppError(
      blockReason
        ? `The request was blocked by Gemini's safety filters (${blockReason}).`
        : 'Gemini returned an empty response. Try rephrasing your prompt.',
      422,
      'AI_EMPTY_RESPONSE',
    );
  }

  return {
    text,
    model,
    promptTokens: usage?.promptTokenCount ?? 0,
    completionTokens: usage?.candidatesTokenCount ?? 0,
    totalTokens: usage?.totalTokenCount ?? 0,
    latencyMs,
    finishReason: finishReason ? String(finishReason) : null,
  };
}

interface InternalOptions extends GeminiRequest {
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
}

async function execute(options: InternalOptions): Promise<GeminiResult> {
  const ai = getClient();
  const model = resolveModel(options.tier);
  const startedAt = Date.now();

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (options.signal?.aborted) {
      throw new AppError('Request cancelled.', 499, 'AI_CANCELLED');
    }

    try {
      const response = await ai.models.generateContent({
        model,
        contents: toContents(options.messages),
        config: {
          ...(options.systemInstruction
            ? { systemInstruction: options.systemInstruction }
            : {}),
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxOutputTokens ?? 4096,
          ...(options.responseMimeType
            ? { responseMimeType: options.responseMimeType }
            : {}),
          ...(options.responseSchema ? { responseSchema: options.responseSchema } : {}),
          ...(options.signal ? { abortSignal: options.signal } : {}),
        },
      });

      return toResult(response, model, Date.now() - startedAt);
    } catch (error) {
      // A safety block or empty body is deterministic — retrying wastes quota.
      if (error instanceof AppError) throw error;

      lastError = error;

      if (attempt === MAX_ATTEMPTS || !isRetryable(error)) break;

      const delay = BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * 200;
      logger.warn(
        { attempt, model, delayMs: Math.round(delay), err: error },
        'gemini request failed, retrying',
      );
      await sleep(delay);
    }
  }

  const status = extractStatus(lastError);
  logger.error({ err: lastError, model, status }, 'gemini request failed');

  if (status === 429) {
    throw new AppError(
      'The AI service is rate limited right now. Please try again shortly.',
      429,
      'AI_RATE_LIMITED',
    );
  }
  if (status === 401 || status === 403) {
    throw new AppError('The configured Gemini API key was rejected.', 502, 'AI_AUTH_FAILED');
  }

  throw new AppError(
    'The AI service is temporarily unavailable. Please try again.',
    503,
    'AI_UNAVAILABLE',
  );
}

/** Free-form text generation. */
export async function generateText(request: GeminiRequest): Promise<GeminiResult> {
  return execute(request);
}

/** Single-turn convenience wrapper around {@link generateText}. */
export async function generateFromPrompt(
  prompt: string,
  options: Omit<GeminiRequest, 'messages'> = {},
): Promise<GeminiResult> {
  return execute({ ...options, messages: [{ role: 'user', content: prompt }] });
}

/**
 * Structured generation. Gemini is constrained to emit JSON matching
 * `responseSchema`, and the result is validated by `parse` before returning —
 * so callers receive typed data, never a string they must trust.
 */
export async function generateJson<T>(
  request: GeminiRequest & {
    responseSchema: Record<string, unknown>;
    parse: (value: unknown) => T;
  },
): Promise<GeminiJsonResult<T>> {
  const { parse, responseSchema, ...rest } = request;

  const result = await execute({
    ...rest,
    responseMimeType: 'application/json',
    responseSchema,
    // Structured output degrades with high temperature.
    temperature: rest.temperature ?? 0.3,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    logger.error({ raw: result.text.slice(0, 500) }, 'gemini returned malformed JSON');
    throw new AppError(
      'The AI returned a malformed response. Please try again.',
      502,
      'AI_INVALID_JSON',
    );
  }

  const { text, ...metadata } = result;
  return { ...metadata, data: parse(parsed), raw: text };
}

/**
 * Streams generated text chunk by chunk for the chat UI. Yields incremental
 * deltas; the caller is responsible for persisting the accumulated result.
 */
export async function* streamText(
  request: GeminiRequest,
): AsyncGenerator<string, GeminiResult, undefined> {
  const ai = getClient();
  const model = resolveModel(request.tier);
  const startedAt = Date.now();

  let stream: AsyncGenerator<GenerateContentResponse>;
  try {
    stream = await ai.models.generateContentStream({
      model,
      contents: toContents(request.messages),
      config: {
        ...(request.systemInstruction
          ? { systemInstruction: request.systemInstruction }
          : {}),
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxOutputTokens ?? 4096,
        ...(request.signal ? { abortSignal: request.signal } : {}),
      },
    });
  } catch (error) {
    logger.error({ err: error, model }, 'gemini stream failed to start');
    throw new AppError(
      'The AI service is temporarily unavailable. Please try again.',
      503,
      'AI_UNAVAILABLE',
    );
  }

  let accumulated = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let finishReason: string | null = null;

  for await (const chunk of stream) {
    const delta = chunk.text ?? '';
    if (delta) {
      accumulated += delta;
      yield delta;
    }

    // Usage and finish reason arrive on the final chunks.
    if (chunk.usageMetadata) {
      promptTokens = chunk.usageMetadata.promptTokenCount ?? promptTokens;
      completionTokens = chunk.usageMetadata.candidatesTokenCount ?? completionTokens;
      totalTokens = chunk.usageMetadata.totalTokenCount ?? totalTokens;
    }
    const reason = chunk.candidates?.[0]?.finishReason;
    if (reason) finishReason = String(reason);
  }

  if (!accumulated.trim()) {
    throw new AppError(
      'Gemini returned an empty response. Try rephrasing your prompt.',
      422,
      'AI_EMPTY_RESPONSE',
    );
  }

  return {
    text: accumulated,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    latencyMs: Date.now() - startedAt,
    finishReason,
  };
}

export const geminiService = {
  generateText,
  generateFromPrompt,
  generateJson,
  streamText,
  isConfigured: (): boolean => env.hasGemini,
} as const;
