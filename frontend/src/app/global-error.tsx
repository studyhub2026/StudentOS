'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary for errors thrown in the root layout itself. It replaces
 * the entire document, so it ships its own <html>/<body> and inline styles
 * rather than relying on the app's stylesheet, which may not have loaded.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#08080c',
          color: '#e7e7ea',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          textAlign: 'center',
          padding: '1.5rem',
        }}
      >
        <div style={{ maxWidth: '28rem' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ marginTop: '0.5rem', color: '#a1a1aa', fontSize: '0.875rem' }}>
            The application hit an unexpected error. Reloading usually clears it.
          </p>
          {error.digest ? (
            <p style={{ marginTop: '0.75rem', fontFamily: 'monospace', fontSize: '0.75rem', color: '#71717a' }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.25rem',
              cursor: 'pointer',
              borderRadius: '0.75rem',
              border: 'none',
              padding: '0.625rem 1.25rem',
              fontWeight: 600,
              color: 'white',
              background: 'linear-gradient(135deg, #6366f1, #22d3ee)',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
