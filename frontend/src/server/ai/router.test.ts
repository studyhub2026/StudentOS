import { describe, expect, it, vi, beforeEach } from 'vitest';

// The router reads env at call-time, so we mock @/server/env with mutable
// getters that individual tests set. Provider adapters are mocked so we
// never talk to Gemini or DeepSeek in unit tests.

const envState = {
  hasGemini: true,
  hasDeepSeek: false,
  AI_CHAT_PROVIDER: '',
  AI_JSON_PROVIDER: '',
  AI_REASONING_PROVIDER: '',
  AI_SUMMARY_PROVIDER: '',
};

vi.mock('@/server/env', () => ({
  env: new Proxy(
    {},
    {
      get: (_t, prop: string) => (envState as Record<string, unknown>)[prop],
    },
  ),
}));

vi.mock('./gemini-provider', () => ({
  geminiProvider: {
    id: 'gemini',
    isConfigured: () => envState.hasGemini,
    generateText: vi.fn(),
    generateJson: vi.fn(),
    streamText: vi.fn(),
  },
}));

vi.mock('./deepseek-provider', () => ({
  deepseekProvider: {
    id: 'deepseek',
    isConfigured: () => envState.hasDeepSeek,
    generateText: vi.fn(),
    generateJson: vi.fn(),
    streamText: vi.fn(),
  },
}));

const { resolveProvider, isProviderId, getProvider } = await import('./router');
const { AppError } = await import('@/server/lib/errors');

beforeEach(() => {
  envState.hasGemini = true;
  envState.hasDeepSeek = false;
  envState.AI_CHAT_PROVIDER = '';
  envState.AI_JSON_PROVIDER = '';
  envState.AI_REASONING_PROVIDER = '';
  envState.AI_SUMMARY_PROVIDER = '';
});

describe('resolveProvider', () => {
  it('defaults chat to Gemini when no env override', () => {
    const p = resolveProvider({ task: 'chat' });
    expect(p.id).toBe('gemini');
  });

  it('respects AI_CHAT_PROVIDER=deepseek when DeepSeek is configured', () => {
    envState.AI_CHAT_PROVIDER = 'deepseek';
    envState.hasDeepSeek = true;
    const p = resolveProvider({ task: 'chat' });
    expect(p.id).toBe('deepseek');
  });

  it('falls back to Gemini when the requested provider is not configured', () => {
    envState.AI_CHAT_PROVIDER = 'deepseek';
    envState.hasDeepSeek = false; // key missing
    const p = resolveProvider({ task: 'chat' });
    expect(p.id).toBe('gemini');
  });

  it('honours preferredProvider over env when configured', () => {
    envState.hasDeepSeek = true;
    envState.AI_CHAT_PROVIDER = 'gemini';
    const p = resolveProvider({ task: 'chat', preferredProvider: 'deepseek' });
    expect(p.id).toBe('deepseek');
  });

  it('ignores an unconfigured preferredProvider', () => {
    envState.hasDeepSeek = false;
    const p = resolveProvider({ task: 'chat', preferredProvider: 'deepseek' });
    expect(p.id).toBe('gemini');
  });

  it('routes reasoning through AI_REASONING_PROVIDER', () => {
    envState.AI_REASONING_PROVIDER = 'deepseek';
    envState.hasDeepSeek = true;
    const p = resolveProvider({ task: 'reasoning' });
    expect(p.id).toBe('deepseek');
  });

  it('summary inherits AI_CHAT_PROVIDER when AI_SUMMARY_PROVIDER is unset', () => {
    envState.AI_CHAT_PROVIDER = 'deepseek';
    envState.hasDeepSeek = true;
    const p = resolveProvider({ task: 'summary' });
    expect(p.id).toBe('deepseek');
  });

  it('mindmap-generate follows AI_JSON_PROVIDER', () => {
    envState.AI_JSON_PROVIDER = 'deepseek';
    envState.hasDeepSeek = true;
    const p = resolveProvider({ task: 'mindmap-generate' });
    expect(p.id).toBe('deepseek');
  });

  it('throws when no provider is configured at all (deployment misconfig)', () => {
    envState.hasGemini = false;
    envState.hasDeepSeek = false;
    expect(() => resolveProvider({ task: 'chat' })).toThrow(AppError);
  });
});

describe('isProviderId', () => {
  it('accepts known ids', () => {
    expect(isProviderId('gemini')).toBe(true);
    expect(isProviderId('deepseek')).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isProviderId('openai')).toBe(false);
    expect(isProviderId('')).toBe(false);
    expect(isProviderId('GEMINI')).toBe(false);
  });
});

describe('getProvider', () => {
  it('returns the registered instance', () => {
    expect(getProvider('gemini').id).toBe('gemini');
    expect(getProvider('deepseek').id).toBe('deepseek');
  });
});
