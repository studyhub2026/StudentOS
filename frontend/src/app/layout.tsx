import type { Metadata, Viewport } from 'next';
import { ServiceWorkerProvider } from '@/components/pwa/service-worker-provider';
import { AppProviders } from '@/providers/app-providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'StudentOS AI — Your academic operating system',
    template: '%s · StudentOS AI',
  },
  description:
    'Assignments, scheduling, notes, flashcards and focus sessions in one AI-powered workspace built for students.',
  applicationName: 'StudentOS AI',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'StudentOS',
  },
  openGraph: {
    title: 'StudentOS AI',
    description: 'The AI-powered operating system for your studies.',
    type: 'website',
  },
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
