'use client';

import { useUser } from '@clerk/nextjs';
import { usePostHog } from 'posthog-js/react';
import { useEffect } from 'react';

export default function PostHogIdentify() {
  const { user, isLoaded } = useUser();
  const posthog = usePostHog();

  useEffect(() => {
    if (!isLoaded || !posthog) return;

    if (user && !posthog._isIdentified()) {
      posthog.identify(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        name: user.fullName,
      });
    }

    if (!user && posthog._isIdentified()) {
      posthog.reset();
    }
  }, [user, isLoaded, posthog]);

  return null;
}
