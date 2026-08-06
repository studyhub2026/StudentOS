'use client';

import { useEffect, useState } from 'react';
import { Download, RefreshCw, WifiOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Registers the service worker and surfaces the two states a user needs to
 * know about: a new version being ready, and being offline.
 *
 * Registration is deliberately skipped in development — a cached service
 * worker fighting hot reload produces confusing, hard-to-diagnose staleness.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function ServiceWorkerProvider() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [offline, setOffline] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setOffline(!navigator.onLine);
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    const onInstallPrompt = (event: Event) => {
      // Suppress the browser's own banner so the prompt appears where it makes
      // sense in the UI rather than over it.
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onInstallPrompt);

    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      void navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          if (registration.waiting) setWaitingWorker(registration.waiting);

          registration.addEventListener('updatefound', () => {
            const installing = registration.installing;
            if (!installing) return;

            installing.addEventListener('statechange', () => {
              // "installed" with an existing controller means an update is
              // ready but not yet active.
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                setWaitingWorker(installing);
              }
            });
          });
        })
        .catch(() => {
          // A failed registration must never break the app; the site simply
          // runs without offline support.
        });

      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      });
    }

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
    };
  }, []);

  return (
    <>
      {offline ? (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-warning/90 px-4 py-1.5 text-xs font-medium text-black"
        >
          <WifiOff className="h-3.5 w-3.5" aria-hidden />
          You are offline — recently viewed pages are still available.
        </div>
      ) : null}

      {waitingWorker ? (
        <div className="glass fixed bottom-4 left-4 z-[60] flex items-center gap-3 rounded-xl p-3 shadow-[var(--shadow-float)]">
          <RefreshCw className="h-4 w-4 shrink-0 text-brand-bright" aria-hidden />
          <div>
            <p className="text-sm font-medium">A new version is ready</p>
            <p className="text-xs text-fg-subtle">Reload to update.</p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              waitingWorker.postMessage({ type: 'SKIP_WAITING' });
              setWaitingWorker(null);
            }}
          >
            Reload
          </Button>
        </div>
      ) : null}

      {installPrompt && !installDismissed ? (
        <div className="glass fixed bottom-4 right-4 z-[60] flex items-center gap-3 rounded-xl p-3 shadow-[var(--shadow-float)]">
          <Download className="h-4 w-4 shrink-0 text-brand-bright" aria-hidden />
          <div>
            <p className="text-sm font-medium">Install OmnelOS</p>
            <p className="text-xs text-fg-subtle">Works offline, opens like an app.</p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              void installPrompt.prompt().then(() => setInstallPrompt(null));
            }}
          >
            Install
          </Button>
          <button
            type="button"
            aria-label="Dismiss install prompt"
            onClick={() => setInstallDismissed(true)}
            className="rounded p-1 text-fg-subtle hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </>
  );
}
