import type { Metadata, Viewport } from 'next';
import { ServiceWorkerProvider } from '@/components/pwa/service-worker-provider';
import { AppProviders } from '@/providers/app-providers';
import './globals.css';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

const DESCRIPTION =
  'The AI Operating System for Learning — assignments, scheduling, notes, flashcards and focus sessions in one AI-powered workspace built for students.';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: 'OmnelOS — The AI Operating System for Learning',
    template: '%s · OmnelOS',
  },
  description: DESCRIPTION,
  applicationName: 'OmnelOS',
  keywords: [
    'omnelos',
    'student productivity',
    'AI study assistant',
    'assignments',
    'flashcards',
    'spaced repetition',
    'study planner',
    'notes',
    'focus timer',
  ],
  authors: [{ name: 'OmnelOS' }],
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/logo.svg', type: 'image/svg+xml' },
      { url: '/favicon.png', type: 'image/png' },
    ],
    apple: '/logo.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'OmnelOS',
  },
  openGraph: {
    type: 'website',
    siteName: 'OmnelOS',
    url: '/',
    title: 'OmnelOS — The AI Operating System for Learning',
    description: DESCRIPTION,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OmnelOS',
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#08080c',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <AppProviders>
          <ServiceWorkerProvider />
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
