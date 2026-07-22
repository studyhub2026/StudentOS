import Link from 'next/link';
import { WifiOff } from 'lucide-react';

export const metadata = { title: 'Offline' };

/**
 * Served by the service worker when a navigation fails and no cached copy of
 * the requested page exists. Intentionally static — it must render with no
 * network, no data and no client-side state.
 */
export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div className="max-w-sm">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-border bg-surface">
          <WifiOff className="h-6 w-6 text-fg-subtle" aria-hidden />
        </span>

        <h1 className="mt-5 text-xl font-semibold">You are offline</h1>
        <p className="mt-2 text-sm text-fg-muted">
          This page has not been saved for offline use. Pages you have already
          visited are still available, and anything you write will be saved once
          you reconnect.
        </p>

        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-xl bg-gradient-to-br from-brand to-accent px-4 py-2 text-sm font-medium text-white"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
