'use client';

import { useEffect, useRef } from 'react';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';
import { useAuthStore } from '@/stores/auth-store';
import { useLocale } from '@/lib/i18n/provider';
import { LOCALES, type Locale } from '@/lib/i18n/dictionaries';

/**
 * Pulls the signed-in user's stored locale from /auth/settings and hydrates
 * the LocaleProvider with it. Without this, a user who chose Arabic on one
 * device would still see the English UI on a fresh browser because the
 * provider only reads localStorage. Server-side content (AI briefs, emails)
 * uses UserSettings.locale directly, so if we don't sync, the UI chrome and
 * the AI-generated body render in different languages.
 *
 * Runs once per session — after the auth store has confirmed a user is
 * signed in — and only re-applies when the server locale differs from the
 * one already active in the provider (so it doesn't fight optimistic
 * updates from the LanguageCard).
 */
export function LocaleSync() {
  const user = useAuthStore((s) => s.user);
  const initialised = useAuthStore((s) => s.initialised);
  const { locale, setLocale } = useLocale();
  const syncedForUser = useRef<string | null>(null);

  useEffect(() => {
    if (!initialised || !user) return;
    if (syncedForUser.current === user.id) return;
    syncedForUser.current = user.id;
    (async () => {
      try {
        const { data } = await apiClient.get<ApiEnvelope<{ locale?: string }>>(
          '/auth/settings',
        );
        const serverLocale = data.data.locale;
        if (
          serverLocale &&
          (LOCALES as string[]).includes(serverLocale) &&
          serverLocale !== locale
        ) {
          setLocale(serverLocale as Locale);
        }
      } catch {
        /* Settings fetch failed — keep the provider's current value. */
      }
    })();
  }, [initialised, user, locale, setLocale]);

  return null;
}
