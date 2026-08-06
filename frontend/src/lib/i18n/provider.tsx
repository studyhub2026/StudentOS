'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  LOCALES,
  directionOf,
  translate,
  type Locale,
  type TranslationKey,
} from './dictionaries';

interface LocaleContextValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);
const LS_KEY = 'studentos.locale';

/**
 * Reads locale from localStorage on first paint so switches survive a reload
 * without waiting on the /auth/settings roundtrip. The auth-settings hook can
 * still overwrite this later if the server has a stored value.
 */
function readInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem(LS_KEY);
    if (stored && (LOCALES as string[]).includes(stored)) return stored as Locale;
  } catch {
    /* storage disabled */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return nav?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  // Hydrate on mount so SSR / first render is stable (always 'en' server-side)
  // and the client swap happens once inside an effect.
  useEffect(() => {
    setLocaleState(readInitialLocale());
  }, []);

  // Sync <html dir> and <html lang> so Tailwind's rtl: variants and screen
  // readers pick the right direction and language.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
    document.documentElement.dir = directionOf(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(LS_KEY, next);
    } catch {
      /* storage disabled */
    }
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      dir: directionOf(locale),
      setLocale,
      t: (key) => translate(locale, key),
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    // Return a safe fallback rather than throw — makes the hook usable in
    // detached test renders and avoids crashing legacy screens that haven't
    // been wrapped yet.
    return {
      locale: 'en',
      dir: 'ltr',
      setLocale: () => {},
      t: (key) => translate('en', key),
    };
  }
  return ctx;
}

/** Ergonomic shortcut for consumers that only need the translator. */
export function useT() {
  return useLocale().t;
}
