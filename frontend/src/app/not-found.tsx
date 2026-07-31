import Link from 'next/link';
import { Compass, Home } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <div className="max-w-md">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand/12">
          <Compass className="h-6 w-6 text-brand-bright" aria-hidden />
        </span>
        <p className="mt-4 text-sm font-semibold uppercase tracking-widest text-fg-subtle">404</p>
        <h1 className="mt-1 text-2xl font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-fg-muted">
          The page you are looking for doesn&apos;t exist or has moved.
        </p>
        <Link href="/dashboard" className={`mt-5 ${buttonVariants({ variant: 'primary' })}`}>
          <Home className="h-4 w-4" aria-hidden />
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
