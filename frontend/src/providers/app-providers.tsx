'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { isAxiosError } from 'axios';
import { useAuthStore } from '@/stores/auth-store';
import { LocaleProvider } from '@/lib/i18n/provider';

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Client errors will not succeed on retry; only retry transient
          // network and server failures, and only twice.
          if (isAxiosError(error)) {
            const status = error.response?.status;
            if (status && status >= 400 && status < 500) return false;
          }
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function AppProviders({ children }: { children: ReactNode }) {
  // Created in state so each browser session gets one client, and it is never
  // shared across users during SSR.
  const [queryClient] = useState(createQueryClient);
  const bootstrap = useAuthStore((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'var(--color-surface-raised)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-fg)',
            },
          }}
        />
      </LocaleProvider>
    </QueryClientProvider>
  );
}
