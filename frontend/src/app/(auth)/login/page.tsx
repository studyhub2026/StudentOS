'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { OAuthButtons } from '@/components/auth/oauth-buttons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiErrorCode, apiErrorMessage } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  totp: z.string().optional(),
  rememberMe: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useAuthStore((state) => state.login);

  // Revealed only after the backend reports that this account needs a code.
  const [needsTotp, setNeedsTotp] = useState(false);
  const oauthError = searchParams.get('error');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values.email, values.password, values.totp, values.rememberMe);
      router.push('/dashboard');
    } catch (error) {
      if (apiErrorCode(error) === 'BAD_REQUEST' && !needsTotp) {
        setNeedsTotp(true);
        toast.info('Enter the code from your authenticator app');
        return;
      }
      toast.error(apiErrorMessage(error));
    }
  });

  return (
    <Card>
      <h1 className="text-xl font-semibold">Welcome back</h1>
      <p className="mt-1 mb-6 text-sm text-fg-muted">Sign in to continue studying.</p>

      {oauthError ? (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {oauthError === 'oauth_cancelled' ? 'Sign-in was cancelled.' : oauthError}
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@school.edu"
          error={errors.email?.message}
          {...register('email')}
        />

        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••••"
          error={errors.password?.message}
          {...register('password')}
        />

        {needsTotp ? (
          <Input
            label="Two-factor code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            error={errors.totp?.message}
            {...register('totp')}
          />
        ) : null}

        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border bg-surface-raised accent-[var(--color-brand)]"
              {...register('rememberMe')}
            />
            Remember me
          </label>

          <Link href="/forgot-password" className="text-sm text-brand-bright hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>

      <OAuthButtons />

      <p className="mt-6 text-center text-sm text-fg-muted">
        New here?{' '}
        <Link href="/register" className="text-brand-bright hover:underline">
          Create an account
        </Link>
      </p>
    </Card>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary during prerendering.
  return (
    <Suspense fallback={<Card className="h-96 animate-pulse" />}>
      <LoginForm />
    </Suspense>
  );
}
