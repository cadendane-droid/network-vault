'use client';

import { usePostHog } from 'posthog-js/react';
import { useEffect } from 'react';

// Fires a profile_viewed event on mount. Rendered from the (server-component)
// person profile page, which can't call the browser PostHog client itself.
export default function TrackProfileView({
  personId,
  factCount,
  hasConfirmedFacts,
}: {
  personId: string;
  factCount: number;
  hasConfirmedFacts: boolean;
}) {
  const posthog = usePostHog();

  useEffect(() => {
    // person-level props (ids/booleans/counts only — never the name) keep
    // profile_viewed semantically distinct from a raw $pageview on
    // /people/[id], whose pathname already carries the id.
    posthog?.capture('profile_viewed', {
      person_id: personId,
      fact_count: factCount,
      has_confirmed_facts: hasConfirmedFacts,
    });
  }, [posthog, personId, factCount, hasConfirmedFacts]);

  return null;
}
