'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import type { ApiEnvelope } from '@/types/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  discord: 'Discord',
};

/**
 * Renders only the providers the backend actually has credentials for, so an
 * unconfigured button never dead-ends the user.
 */
export function OAuthButtons() {
  const { data: providers, isLoading } = useQuery({
    queryKey: ['oauth-providers'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiEnvelope<{ providers: string[] }>>(
        '/auth/oauth/providers',
      );
      return data.data.providers;
    },
    staleTime: 10 * 60_000,
  });

  if (isLoading || !providers?.length) return null;

  return (
    <>
      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-fg-subtle">or continue with</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="grid gap-2">
        {providers.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="secondary"
            // A full navigation, not fetch — the OAuth flow requires a
            // top-level redirect to the provider's consent screen.
            onClick={() => {
              window.location.href = `${API_URL}/api/v1/auth/oauth/${provider}`;
            }}
          >
            Continue with {PROVIDER_LABELS[provider] ?? provider}
          </Button>
        ))}
      </div>
    </>
  );
}
