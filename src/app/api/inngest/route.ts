import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { extractPersonFacts } from '@/inngest/functions/extract';
import { embedPersonFacts } from '@/inngest/functions/embed';

// Inngest invokes our functions by calling back to the serve URL it has on
// record. By default `serve()` infers that origin from the incoming request's
// Host header — but on Vercel the sync/registration request arrives at the
// per-deployment URL (network-vault-<hash>.vercel.app), which is replaced on
// every new deploy. Inngest then keeps invoking the stale deployment URL and
// gets DEPLOYMENT_NOT_FOUND, so runs fail before any step executes.
//
// Pinning `serveOrigin` to the stable production domain makes Inngest register
// and invoke at https://www.almura.app regardless of which deployment handled
// the sync. We only force it on Vercel *production* — leaving it unset for
// local `inngest dev` and preview deploys so they auto-infer their own origin.
// `INNGEST_SERVE_ORIGIN` overrides everything if a different host is ever needed.
const serveOrigin =
  process.env.INNGEST_SERVE_ORIGIN ??
  (process.env.VERCEL_ENV === 'production'
    ? 'https://www.almura.app'
    : undefined);

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [extractPersonFacts, embedPersonFacts],
  serveOrigin,
});
