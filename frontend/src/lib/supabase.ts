'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client, used only for Realtime (live group chat).
 *
 * The anon key is public by design; row access still goes through the
 * membership-gated REST API. Sessions are not persisted here — auth is handled
 * by our own JWT/refresh cookie flow, and this client never touches the
 * database directly, only the Realtime channel a group broadcasts on.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** True when Realtime is configured; the chat UI degrades gracefully without it. */
export const hasRealtime = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!hasRealtime || typeof window === 'undefined') return null;
  client ??= createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return client;
}
