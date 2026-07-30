'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { OAuthButtons } from '@/components/auth/oauth-buttons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiErrorMessage } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

/** Mirrors src/server/validators/auth.validator.ts so errors surface early. */
const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  username: z
    .string()
    .trim()
    .min(3, 'At least 3 characters')
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Letters, numbers, hyphens and underscores only'),
  password: z
    .string()
    .min(10, 'At least 10 characters')
    .regex(/[a-z]/, 'Needs a lowercase letter')
    .regex(/[A-Z]/, 'Needs an uppercase letter')
    .regex(/[0-9]/, 'Needs a number'),
});

type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const registerUser = useAuthStore((state) => state.register);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await registerUser(values);
      toast.success('Account created. Check your email to verify it.');
      router.push('/dashboard');
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  });

  return (
    <Card>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <p className="mt-1 mb-6 text-sm text-fg-muted">Start organising your studies today.</p>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Input
          label="Full name"
          autoComplete="name"
          placeholder="Alex Morgan"
          error={errors.name?.message}
          {...register('name')}
        />

        <Input
          label="Username"
          autoComplete="username"
          placeholder="alexm"
          error={errors.username?.message}
          {...register('username')}
        />

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
          autoComplete="new-password"
          placeholder="••••••••••"
          hint="At least 10 characters, with upper, lower and a number."
          error={errors.password?.message}
          {...register('password')}
        />

        <Button type="submit" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>

      <OAuthButtons />

      <p className="mt-6 text-center text-sm text-fg-muted">
        Already have an account?{' '}
        <Link href="/login" className="text-brand-bright hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
