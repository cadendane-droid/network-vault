import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function LandingPage() {
  const { userId } = await auth();

  // Authenticated users go straight to their vault — no marketing content shown.
  if (userId) redirect('/people');

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 px-6 text-center">
      {/* Decorative constellation cluster */}
      <div className="flex items-end gap-2.5 mb-10">
        <span className="h-2 w-2 rounded-full bg-violet-500 opacity-90" />
        <span className="h-3 w-3 rounded-full bg-violet-600" />
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 opacity-70 mb-1" />
        <span className="h-2.5 w-2.5 rounded-full bg-violet-400 opacity-60 mb-0.5" />
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-600 opacity-50" />
      </div>

      {/* Wordmark */}
      <h1 className="text-3xl font-semibold tracking-tight text-white mb-3">
        Network Vault
      </h1>

      {/* One-line description */}
      <p className="text-base text-zinc-400 max-w-xs leading-relaxed mb-10">
        A private, queryable knowledge base for the people who matter to you.
      </p>

      {/* Primary CTA */}
      <Link
        href="/sign-up"
        className="rounded-full bg-violet-600 px-7 py-3 text-sm font-medium text-white hover:bg-violet-500 active:bg-violet-700 transition-colors"
      >
        Get started
      </Link>

      {/* Secondary — returning users */}
      <Link
        href="/sign-in"
        className="mt-4 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        Sign in
      </Link>
    </div>
  );
}
