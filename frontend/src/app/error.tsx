'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, Home, RotateCcw } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';

/**
 * Route-level error boundary. Next renders this in place of any page (and its
 * nested layouts) that throws while rendering, so a single broken query never
 * blanks the whole app.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced to the browser console; server errors are already logged
    // server-side with a matching digest.
    console.error(error);
  }, [error]);

  return (
    <div className="grid min-h-[70vh] place-items-center p-6 text-center">
      <div className="max-w-md">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-danger/12">
          <AlertTriangle className="h-6 w-6 text-danger" aria-hidden />
        </span>
        <h1 className="mt-4 text-xl font-semibold">Something went wrong</h1>
        <p className="mt-1 text-sm text-fg-muted">
          An unexpected error interrupted this page. You can retry, or head back to your dashboard.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-xs text-fg-subtle">Reference: {error.digest}</p>
        ) : null}
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button onClick={reset}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            Try again
          </Button>
          <Link href="/dashboard" className={buttonVariants({ variant: 'secondary' })}>
            <Home className="h-4 w-4" aria-hidden />
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
