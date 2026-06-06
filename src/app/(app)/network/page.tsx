import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import Constellation from '@/components/constellation';

export default async function NetworkPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerk_id: clerkId },
    select: { id: true },
  });
  if (!dbUser) redirect('/sign-in');

  // Count only active people — archived entries don't appear in the graph.
  const peopleCount = await prisma.people.count({
    where: { user_id: dbUser.id, status: 'active' },
  });

  // The graph needs at least two nodes to be meaningful. Show a guided
  // empty state rather than rendering a graph with a single isolated node.
  if (peopleCount < 2) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100dvh-4rem)] bg-zinc-950 px-6 text-center">
        <div className="mb-5 flex gap-2">
          {/* Decorative constellation dots */}
          <span className="h-2.5 w-2.5 rounded-full bg-violet-600 opacity-80" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-600 opacity-60 translate-y-1" />
          <span className="h-2.5 w-2.5 rounded-full bg-violet-500 opacity-50 -translate-y-0.5" />
        </div>

        <h1 className="text-lg font-semibold text-white mb-2">
          Your constellation is empty
        </h1>
        <p className="text-sm text-zinc-400 max-w-xs mb-6 leading-relaxed">
          Add at least two people to see how your network connects. Each person
          becomes a node; shared context and relationships become the edges
          between them.
        </p>

        <Link
          href="/people/new"
          className="rounded-full bg-violet-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-violet-500 transition-colors"
        >
          {peopleCount === 0 ? 'Add your first person' : 'Add another person'}
        </Link>

        {peopleCount === 1 && (
          <Link
            href="/people"
            className="mt-3 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            View people
          </Link>
        )}
      </div>
    );
  }

  // Full-screen graph — height accounts for the fixed bottom nav (4rem).
  // Constellation handles its own loading state for the client-side data fetch.
  return (
    <div className="h-[calc(100dvh-4rem)]">
      <Constellation />
    </div>
  );
}
