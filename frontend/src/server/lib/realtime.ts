import 'server-only';
import { env } from '@/server/env';
import { logger } from '@/server/lib/logger';

/**
 * Server-side broadcast to Supabase Realtime.
 *
 * Uses Supabase's HTTP broadcast endpoint rather than a persistent Realtime
 * socket, because a serverless function cannot hold a connection open. Clients
 * subscribe to the same topic with the anon key and receive these events live.
 *
 * Broadcasting is best-effort: if Supabase Realtime is not configured, or the
 * call fails, the REST response still succeeds — live delivery is an
 * enhancement over the authoritative, membership-checked REST API, never a
 * dependency of it.
 *
 * SECURITY NOTE: with the anon key, a client that knows a group id could
 * subscribe to its topic and observe live messages. The REST API remains
 * membership-gated, so history is safe; hardening live delivery requires
 * Supabase Realtime Authorization (RLS on the realtime topic) and is tracked
 * as a follow-up.
 */

export type RealtimeEvent =
  | 'message:new'
  | 'message:deleted'
  | 'message:updated'
  | 'member:joined'
  | 'member:left';

export function groupTopic(groupId: string): string {
  return `group:${groupId}`;
}

export async function broadcast(
  topic: string,
  event: RealtimeEvent,
  payload: unknown,
): Promise<void> {
  if (!env.hasSupabaseRealtime) return;

  try {
    const response = await fetch(`${env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY as string,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ messages: [{ topic, event, payload }] }),
    });

    if (!response.ok) {
      logger.warn({ topic, event, status: response.status }, 'realtime broadcast failed');
    }
  } catch (error) {
    logger.warn({ err: error, topic, event }, 'realtime broadcast errored');
  }
}
