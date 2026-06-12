import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { PostHogProvider } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Network Vault',
  description: 'Your personal relationship intelligence tool',
  // iOS Safari ignores most of the web manifest — home-screen install needs
  // these explicit tags. TODO: add public/apple-touch-icon.png (180×180).
  appleWebApp: {
    capable: true,
    title: 'Almura',
    statusBarStyle: 'default',
  },
  icons: {
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#B95B35', // --terracotta-500, matches manifest theme_color
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className="h-full">
        <body className="min-h-full flex flex-col">
          <PostHogProvider>
            <Suspense>{children}</Suspense>
          </PostHogProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
