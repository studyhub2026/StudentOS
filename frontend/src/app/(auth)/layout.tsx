import Link from 'next/link';
import { OmnelMark } from '@/components/brand/brand-mark';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-6 py-12">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-brand/16 blur-[130px]" />
        <div className="absolute bottom-0 right-0 h-[22rem] w-[22rem] rounded-full bg-accent/10 blur-[120px]" />
      </div>

      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 font-semibold">
          <OmnelMark className="h-8 w-8" />
          <span className="text-xl tracking-tight">
            <span className="text-fg">Omnel</span>
            <span className="gradient-text">OS</span>
          </span>
        </Link>

        {children}
      </div>
    </div>
  );
}
