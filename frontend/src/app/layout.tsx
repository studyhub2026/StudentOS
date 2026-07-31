import type { Metadata, Viewport } from 'next';
import { ServiceWorkerProvider } from '@/components/pwa/service-worker-provider';
import { AppProviders } from '@/providers/app-providers';
import './globals.css';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

const DESCRIPTION =
  'Assignments, scheduling, notes, flashcards and focus sessions in one AI-powered workspace built for students.';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: 'StudentOS AI — Your academic operating system',
    template: '%s · StudentOS AI',
  },
  description: DESCRIPTION,
  applicationName: 'StudentOS AI',
  keywords: [
    'student productivity',
    'AI study assistant',
    'assignments',
    'flashcards',
    'spaced repetition',
    'study planner',
    'notes',
    'focus timer',
  ],
  authors: [{ name: 'StudentOS AI' }],
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'StudentOS',
  },
  openGraph: {
    type: 'website',
    siteName: 'StudentOS AI',
    url: '/',
    title: 'StudentOS AI — Your academic operating system',
    description: DESCRIPTION,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'StudentOS AI',
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
