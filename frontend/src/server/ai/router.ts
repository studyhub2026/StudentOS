import 'server-only';
import { env } from '@/server/env';
import { logger } from '@/server/lib/logger';
import { AppError } from '@/server/lib/errors';
import { deepseekProvider } from './deepseek-provider';
import { geminiProvider } from './gemini-provider';
import type { AiProvider, AiProviderId, AiTaskKind } from './provider';

/**
 * Central provider registry + task-to-provider resolver.
 *
 * Every AI feature calls `resolveProvider({ task })` instead of importing a
 * specific provider directly. Configuration lives in env — never in code —
 * so switching a task's provider is a redeploy, not a rebuild.
 *
 * Precedence for a given task:
 *   1. Task-specific env var (AI_CHAT_PROVIDER for chat, etc.)
 *   2. Task-family fallback (chat/summary/reasoning share sensible defaults)
 *   3. The provider that's actually configured (isConfigured())
 *   4. Gemini (the original) as ultimate fallback so the app never dies
 */

const REGISTRY: Record<AiProviderId, AiProvider> = {
  gemini: geminiProvider,
  deepseek: deepseekProvider,
};

export function getProvider(id: AiProviderId): AiProvider {
  const p = REGISTRY[id];
  if (!p) throw new AppError(`Unknown AI provider: ${id}`, 500, 'AI_INTERNAL');
  return p;
}

export function isProviderId(value: string): value is AiProviderId {
  return value === 'gemini' || value === 'deepseek';
}

function envFor(task: AiTaskKind): string | undefined {
  // Chat + all mind-map interactive calls share the chat routing signal.
  // JSON generation (exam, structured extraction) shares AI_JSON_PROVIDER.
  // Reasoning-heavy tasks (deep analysis) share AI_REASONING_PROVIDER.
  // Summaries share AI_SUMMARY_PROVIDER. Defaults keep Gemini in place.
  switch (task) {
    case 'chat':
    case 'mindmap-node-action':
      return env.AI_CHAT_PROVIDER || undefined;
    case 'json':
    case 'mindmap-generate':
      return env.AI_JSON_PROVIDER || undefined;
    case 'reasoning':
      return env.AI_REASONING_PROVIDER || undefined;
    case 'summary':
      return env.AI_SUMMARY_PROVIDER || env.AI_CHAT_PROVIDER || undefined;
  }
}

export interface ResolveOptions {
  task: AiTaskKind;
  /** Explicit user/UI selection wins over env when it's a configured provider. */
  preferredProvider?: AiProviderId;
}

/**
 * Returns the provider for a task, in the order documented above. Never
 * throws — falls back to Gemini so a mistyped env var can't take AI down.
 */
export function resolveProvider({ task, preferredProvider }: ResolveOptions): AiProvider {
  const candidates: AiProviderId[] = [];

  if (preferredProvider && isProviderId(preferredProvider)) candidates.push(preferredProvider);

  const envHint = envFor(task);
  if (envHint && isProviderId(envHint)) candidates.push(envHint);

  // Gemini is always the ultimate fallback — it's the only provider guaranteed
  // to be configured across every prior deployment.
  candidates.push('gemini');

  for (const id of candidates) {
    const p = getProvider(id);
    if (p.isConfigured()) {
      if (candidates.indexOf(id) > 0) {
        logger.info({ task, chosen: id, wanted: candidates[0] }, 'ai-router: fallback');
      }
      return p;
    }
  }

  // We reach this only when Gemini itself is unconfigured — a real deployment
  // problem worth an explicit error.
  throw new AppError(
    'No AI provider is configured on this deployment.',
    503,
    'AI_NOT_CONFIGURED',
  );
}

export type { AiProvider, AiProviderId, AiTaskKind } from './provider';
export { deepseekProvider, geminiProvider };
