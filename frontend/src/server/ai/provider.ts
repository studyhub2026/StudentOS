import 'server-only';

/**
 * The single AI provider contract every consumer talks to. `geminiService`,
 * `mind-map-ai.service`, `ai-brief.service`, exam generation, chat streaming
 * — all resolve to one of these via the resolver in `router.ts` rather than
 * importing a specific SDK directly.
 *
 * A provider is only responsible for text/JSON/stream generation. Higher-
 * level features (prompt templates, retries at the domain layer, context
 * budgeting, memory injection) live in the service that owns the feature —
 * providers must stay dumb.
 */

/** Kinds of task the resolver routes on. Add cases sparingly. */
export type AiTaskKind =
  | 'chat' // conversational chat with streaming
  | 'json' // structured JSON output (Zod-validated downstream)
  | 'reasoning' // chain-of-thought heavy calls (exam, deep analysis)
  | 'summary' // short, cheap summaries (brief, node-explain)
  | 'mindmap-generate' // whole-map generation
  | 'mindmap-node-action'; // per-node explain/quiz/flashcards

export type AiProviderId = 'gemini' | 'deepseek';

export interface AiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Inline binary (PDF / image) attached to the final user message. */
export interface AiInlineAttachment {
  mimeType: string;
  dataBase64: string;
}

export interface AiTextRequest {
  messages: AiMessage[];
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Aborts in-flight generation on client disconnect. */
  signal?: AbortSignal;
  attachments?: AiInlineAttachment[];
  /**
   * Model tier hint. Providers translate this to their own model ids —
   * `flash`/`fast` = cheap+low-latency, `pro`/`reasoning` = higher quality.
   */
  tier?: 'flash' | 'pro';
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiTextResult {
  provider: AiProviderId;
  model: string;
  text: string;
  usage: AiUsage;
  latencyMs: number;
  finishReason: string | null;
}

export interface AiJsonRequest<T> extends AiTextRequest {
  /**
   * Provider-specific JSON schema hint. For Gemini this is the response
   * schema object; for OpenAI-compatible providers we set response_format:
   * { type: 'json_object' } and rely on `parse` for structural validation.
   * Downstream Zod always has the final say either way.
   */
  responseSchema?: Record<string, unknown>;
  parse: (raw: unknown) => T;
}

export interface AiJsonResult<T> extends Omit<AiTextResult, 'text'> {
  data: T;
  raw: string;
}

/**
 * A provider's `streamText` yields incremental deltas and returns the final
 * accumulated `AiTextResult`. Consumers use `for await` for tokens and read
 * the returned value for usage/model/latency.
 */
export type AiStreamGenerator = AsyncGenerator<string, AiTextResult, undefined>;

export interface AiProvider {
  readonly id: AiProviderId;
  isConfigured(): boolean;
  generateText(request: AiTextRequest): Promise<AiTextResult>;
  generateJson<T>(request: AiJsonRequest<T>): Promise<AiJsonResult<T>>;
  streamText(request: AiTextRequest): AiStreamGenerator;
}
