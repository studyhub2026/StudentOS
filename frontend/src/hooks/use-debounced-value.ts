'use client';

import { useEffect, useState } from 'react';

/**
 * Delays propagating a rapidly changing value — used so each keystroke in the
 * search box does not fire its own request.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
