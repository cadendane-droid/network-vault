'use client';

import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { Suspense } from 'react';
import PostHogIdentify from './PostHogIdentify';
import PostHogPageView from './PostHogPageView';

if (typeof window !== 'undefined') {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    person_profiles: 'identified_only',
    // Manual $pageview (see PostHogPageView) stays the source of truth — leave
    // automatic capture off. capture_pageleave is independent: with it `true`,
    // posthog-js emits $pageleave on real page-hide/unload (tab close, hard nav,
    // backgrounding) for session-duration math. NOTE: this version
    // (posthog-js 1.386.4) does NOT emit $pageleave on App Router soft
    // navigations — pageleave fires only from the unload path. Per-page dwell
    // across soft nav is reconstructed from consecutive $pageview timestamps +
    // previous_pathname instead.
    capture_pageview: false,
    capture_pageleave: true,
  });
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      <PostHogIdentify />
      {children}
    </PHProvider>
  );
}
