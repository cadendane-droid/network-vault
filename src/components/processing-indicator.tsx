'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  personId: string;
  initialStatus: string;
}

const isTerminal = (s: string) => s === 'complete' || s === 'failed';

/**
 * Polls GET /api/people/[id]/status every 3 seconds while processing_status
 * is pending or processing. When the status reaches complete it calls
 * router.refresh() so the parent server component re-fetches facts. When the
 * status is failed it shows a "Try again" action that re-runs the pipeline via
 * POST /api/people/[id]/reprocess and resumes polling — so a failed run is
 * recoverable in-place instead of leaving the user stranded.
 */
export function ProcessingIndicator({ personId, initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [retrying, setRetrying] = useState(false);
  const router = useRouter();

  // Poll whenever the status is non-terminal. Keyed on `status` so that a
  // retry (which sets status back to 'processing') restarts the poll loop.
  useEffect(() => {
    if (isTerminal(status)) return;

    const intervalId = setInterval(async () => {
      try {
        const res = await fetch(`/api/people/${personId}/status`);
        if (!res.ok) return;

        const data: { status: string } = await res.json();
        setStatus(data.status);

        if (data.status === 'complete') {
          clearInterval(intervalId);
          // Refresh the server component so extracted facts appear immediately.
          router.refresh();
        } else if (data.status === 'failed') {
          clearInterval(intervalId);
        }
      } catch {
        // Network error — keep polling silently.
      }
    }, 3000);

    return () => clearInterval(intervalId);
  }, [personId, status, router]);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/people/${personId}/reprocess`, {
        method: 'POST',
      });
      if (res.ok) {
        // Resume polling — the effect restarts because status changes.
        setStatus('processing');
      }
    } catch {
      // Leave the failed state in place; the user can retry again.
    } finally {
      setRetrying(false);
    }
  }, [personId]);

  if (status === 'complete') return null;

  if (status === 'failed') {
    return (
      <div className="mt-1 flex flex-col items-center gap-1.5">
        <p className="text-sm text-red-500">
          Processing failed — we couldn&apos;t finish reading these notes.
        </p>
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="rounded-full border border-red-300 px-3 py-1 text-sm text-red-600 disabled:opacity-50"
        >
          {retrying ? 'Retrying…' : 'Try again'}
        </button>
      </div>
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
