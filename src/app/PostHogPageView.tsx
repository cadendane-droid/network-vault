'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { usePostHog } from 'posthog-js/react';
import { useEffect, useRef } from 'react';

export default function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const posthog = usePostHog();
  // Pathname of the previous $pageview, so page-to-page transition counts (#9)
  // are reconstructable from a single event. `null` on the first pageview of a
  // session. Pathnames are route paths (ids only, e.g. /people/<id>) — no PII.
  const prevPathname = useRef<string | null>(null);

  useEffect(() => {
    if (pathname && posthog) {
      let url = window.origin + pathname;
      const search = searchParams.toString();
      if (search) url += `?${search}`;
      posthog.capture('$pageview', {
        $current_url: url,
        // Explicit pathname (also embedded in $current_url) for reconstructable
        // page-open/transition metrics without relying on URL parsing.
        pathname,
        previous_pathname: prevPathname.current,
      });
      prevPathname.current = pathname;
    }
  }, [pathname, searchParams, posthog]);

  return null;
}
