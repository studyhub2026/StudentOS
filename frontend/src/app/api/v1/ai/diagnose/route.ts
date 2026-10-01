export const runtime = 'nodejs';
export const maxDuration = 20;
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/lib/auth';
import { route } from '@/server/lib/handler';
import { ok } from '@/server/lib/response';
import { env } from '@/server/env';

/**
 * GET /api/v1/ai/diagnose
 *
 * A one-shot "why is my AI misbehaving" probe. Reports which providers the
 * runtime sees as configured, which env route hints are in effect, and —
 * crucially — makes a tiny real call to each configured provider and
 * surfaces the raw HTTP response. When Groq (or any provider) rejects a
 * request, the exact error body lands in this response instead of being
 * buried in logs and swallowed by the chat fallback.
 *
 * Auth-gated to any logged-in user so a token leak via a public page would
 * reveal nothing beyond "yes, a provider is set up here".
 */
export const GET = route(async (req: NextRequest) => {
  await requireAuth(req);

  const checks: Record<string, unknown> = {
    env: {
      hasGemini: env.hasGemini,
      hasDeepSeek: env.hasDeepSeek,
      hasGroq: env.hasGroq,
      AI_CHAT_PROVIDER: env.AI_CHAT_PROVIDER || '(not set)',
      AI_JSON_PROVIDER: env.AI_JSON_PROVIDER || '(not set)',
      AI_REASONING_PROVIDER: env.AI_REASONING_PROVIDER || '(not set)',
      AI_SUMMARY_PROVIDER: env.AI_SUMMARY_PROVIDER || '(not set)',
    },
    groq: await probeGroq(),
  };

  return ok(checks);
});

async function probeGroq(): Promise<unknown> {
  if (!env.hasGroq) {
    return {
      status: 'not_configured',
      hint: 'Set GROQ_API_KEY in Vercel → Settings → Environment Variables, then Redeploy.',
    };
  }

  const key = env.GROQ_API_KEY ?? '';
  const keyShape = {
    length: key.length,
    startsWithGsk: key.startsWith('gsk_'),
    hasWhitespace: /\s/.test(key),
    firstChars: key.slice(0, 4),
    lastChars: key.slice(-4),
  };
  if (!keyShape.startsWithGsk) {
    return {
      status: 'bad_key_shape',
      detail: 'Groq keys start with "gsk_" — the value you saved does not. Re-copy it from console.groq.com/keys.',
      keyShape,
    };
  }
  if (keyShape.hasWhitespace) {
    return {
      status: 'bad_key_shape',
      detail: 'The key has whitespace in it (likely a stray newline). Re-paste it without spaces.',
      keyShape,
    };
  }

  const started = Date.now();
  try {
    const res = await fetch(`${env.GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: env.GROQ_DEFAULT_MODEL,
        messages: [{ role: 'user', content: 'reply with the single word "ok"' }],
        max_tokens: 10,
        stream: false,
      }),
    });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* leave as string */
    }

    if (!res.ok) {
      return {
        status: 'http_error',
        httpStatus: res.status,
        latencyMs,
        model: env.GROQ_DEFAULT_MODEL,
        baseUrl: env.GROQ_BASE_URL,
        body: parsed,
        keyShape,
      };
    }

    return {
      status: 'ok',
      httpStatus: res.status,
      latencyMs,
      model: env.GROQ_DEFAULT_MODEL,
      firstChars: typeof parsed === 'object' && parsed !== null
        ? JSON.stringify(parsed).slice(0, 200)
        : String(parsed).slice(0, 200),
    };
  } catch (err) {
    return {
      status: 'network_error',
      error: err instanceof Error ? err.message : String(err),
      model: env.GROQ_DEFAULT_MODEL,
      baseUrl: env.GROQ_BASE_URL,
      keyShape,
    };
  }
}
