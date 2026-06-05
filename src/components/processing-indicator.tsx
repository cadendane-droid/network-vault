'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  personId: string;
  initialStatus: string;
}

/**
 * Polls GET /api/people/[id]/status every 3 seconds while processing_status
 * is pending or processing. When the status reaches complete or failed, calls
 * router.refresh() so the parent server component re-fetches facts and the
 * processing banner disappears without a full page navigation.
 */
export function ProcessingIndicator({ personId, initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const router = useRouter();

  useEffect(() => {
    // Don't start polling if the status is already terminal on mount
    // (or after router.refresh() passes a new initialStatus).
    if (initialStatus === 'complete' || initialStatus === 'failed') return;

    const intervalId = setInterval(async () => {
      try {
        const res = await fetch(`/api/people/${personId}/status`);
        if (!res.ok) return;

        const data: { status: string } = await res.json();
        setStatus(data.status);

        if (data.status === 'complete' || data.status === 'failed') {
          clearInterval(intervalId);
          // Refresh the server component so extracted facts appear immediately.
          router.refresh();
        }
      } catch {
        // Network error — keep polling silently.
      }
    }, 3000);

    return () => clearInterval(intervalId);
  }, [personId, initialStatus, router]);

  if (status === 'complete') return null;

  if (status === 'failed') {
    return (
      <p className="mt-1 text-sm text-red-500">
        Processing failed — try re-submitting this person&apos;s notes.
      </p>
    );
  }

  // pending or processing
  return (
    <div className="mt-1 flex items-center gap-2">
      <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-pulse" />
      <p className="text-sm text-zinc-500">
        Extracting facts&hellip; this usually takes a few seconds.
      </p>
    </div>
  );
}
