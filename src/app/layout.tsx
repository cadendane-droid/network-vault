import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PostHogProvider } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Network Vault',
  description: 'Your personal relationship intelligence tool',
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
