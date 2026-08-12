import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envState = {
  hasDeepSeek: true,
  DEEPSEEK_API_KEY: 'sk-test',
  DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
  DEEPSEEK_DEFAULT_MODEL: 'deepseek-chat',
  DEEPSEEK_REASONING_MODEL: 'deepseek-reasoner',
};

vi.mock('@/server/env', () => ({
  env: new Proxy(
    {},
    { get: (_t, prop: string) => (envState as Record<string, unknown>)[prop] },
  ),
}));

const { deepseekProvider } = await import('./deepseek-provider');
const { AppError } = await import('@/server/lib/errors');

const origFetch = global.fetch;
beforeEach(() => {
  envState.hasDeepSeek = true;
  vi.useFakeTimers();
});
afterEach(() => {
  global.fetch = origFetch;
  vi.useRealTimers();
});

describe('deepseekProvider — configuration', () => {
  it('isConfigured reflects env', () => {
    expect(deepseekProvider.isConfigured()).toBe(true);
    envState.hasDeepSeek = false;
    expect(deepseekProvider.isConfigured()).toBe(false);
  });

  it('generateText throws AI_NOT_CONFIGURED when the key is missing', async () => {
    envState.hasDeepSeek = false;
    await expect(
      deepseekProvider.generateText({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('deepseekProvider — generateText', () => {
  it('returns a normalised AiTextResult on success', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'x',
        model: 'deepseek-chat',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello there!' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
      }),
      text: async () => '',
    } as unknown as Response);

    const res = await deepseekProvider.generateText({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.provider).toBe('deepseek');
    expect(res.model).toBe('deepseek-chat');
    expect(res.text).toBe('Hello there!');
    expect(res.usage).toEqual({ promptTokens: 4, completionTokens: 3, totalTokens: 7 });
    expect(res.finishReason).toBe('stop');
  });

  it('surfaces a friendly auth error on 401 without leaking body', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => 'Invalid API key blah blah',
    } as unknown as Response);
    await expect(
      deepseekProvider.generateText({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrowError(/DeepSeek rejected|AI service|AI_NOT_CONFIGURED/i);
  });

  it('treats empty content as an empty-response error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'deepseek-chat',
        choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      }),
      text: async () => '',
    } as unknown as Response);
    await expect(
      deepseekProvider.generateText({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrowError(/empty response/i);
  });
});

describe('deepseekProvider — generateJson', () => {
  it('parses JSON body and passes it through the caller schema', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'deepseek-chat',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '{"answer":42}' },
            finish_reason: 'stop',
          },
        ],
      }),
      text: async () => '',
    } as unknown as Response);

    const res = await deepseekProvider.generateJson<{ answer: number }>({
      messages: [{ role: 'user', content: 'What?' }],
      parse: (v) => v as { answer: number },
    });
    expect(res.provider).toBe('deepseek');
    expect(res.data).toEqual({ answer: 42 });
    expect(res.raw).toBe('{"answer":42}');
  });

  it('throws AI_INVALID_RESPONSE on malformed JSON', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'deepseek-chat',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'not JSON at all' },
            finish_reason: 'stop',
          },
        ],
      }),
      text: async () => '',
    } as unknown as Response);
    await expect(
      deepseekProvider.generateJson({
        messages: [{ role: 'user', content: 'x' }],
        parse: (v) => v,
      }),
    ).rejects.toThrowError(/malformed JSON/i);
  });
});

describe('deepseekProvider — streamText', () => {
  it('yields deltas parsed from SSE frames and returns the final result', async () => {
    const enc = new TextEncoder();
    const frames = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5},"model":"deepseek-chat"}\n\n',
      'data: [DONE]\n\n',
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const f of frames) controller.enqueue(enc.encode(f));
        controller.close();
      },
    });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    } as unknown as Response);

    const gen = deepseekProvider.streamText({
      messages: [{ role: 'user', content: 'hi' }],
    });

    const deltas: string[] = [];
    let done = await gen.next();
    while (!done.done) {
      deltas.push(done.value);
      done = await gen.next();
    }
    expect(deltas).toEqual(['Hel', 'lo', '!']);
    expect(done.value.text).toBe('Hello!');
    expect(done.value.provider).toBe('deepseek');
    expect(done.value.usage.totalTokens).toBe(5);
    expect(done.value.finishReason).toBe('stop');
  });
});
