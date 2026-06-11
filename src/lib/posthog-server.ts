import { PostHog } from 'posthog-node';

// Module-level singleton — same pattern as src/lib/claude.ts.
// Server-side events (API routes, Inngest jobs) can't use the browser
// posthog-js client; this is the posthog-node equivalent.
const posthogServer = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
});

// Send one event and wait for delivery. captureImmediate (rather than the
// queued capture + periodic flush) because route handlers and Inngest steps
// are short-lived — a queued event may never flush before the process is
// frozen or recycled. Analytics must never break the request, so failures
// are logged and swallowed.
export async function captureServerEvent(
  distinctId: string,
  event: string,
  properties: Record<string, unknown> = {}
): Promise<void> {
  try {
    await posthogServer.captureImmediate({ distinctId, event, properties });
  } catch (err) {
    console.error(`[posthog] failed to capture ${event}:`, err);
  }
}
