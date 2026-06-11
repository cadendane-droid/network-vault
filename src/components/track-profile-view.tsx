'use client';

import { usePostHog } from 'posthog-js/react';
import { useEffect } from 'react';

// Fires a profile_viewed event on mount. Rendered from the (server-component)
// person profile page, which can't call the browser PostHog client itself.
export default function TrackProfileView({ personId }: { personId: string }) {
  const posthog = usePostHog();

  useEffect(() => {
    posthog?.capture('profile_viewed', { person_id: personId });
  }, [posthog, personId]);

  return null;
}
