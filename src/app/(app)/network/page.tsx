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

  // The graph needs at least two nodes to be meaningful.
  if (peopleCount < 2) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: 'calc(100dvh - var(--nav-height))',
          background:
            'radial-gradient(ellipse at center, var(--night-800) 0%, var(--night-900) 100%)',
          padding: '0 var(--gutter)',
          textAlign: 'center',
        }}
      >
        {/* Decorative constellation dots */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--terracotta-300)',
              opacity: 0.8,
              display: 'inline-block',
            }}
          />
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--star-dim)',
              opacity: 0.6,
              display: 'inline-block',
              transform: 'translateY(4px)',
            }}
          />
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--plum-300)',
              opacity: 0.5,
              display: 'inline-block',
              transform: 'translateY(-2px)',
            }}
          />
        </div>

        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-h2)',
            fontWeight: 600,
            color: 'var(--text-on-night)',
            margin: '0 0 10px',
            letterSpacing: 'var(--tracking-tight)',
          }}
        >
          Your constellation is empty
        </h1>

        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            color: 'var(--star-dim)',
            maxWidth: 280,
            margin: '0 0 28px',
            lineHeight: 'var(--leading-normal)',
          }}
        >
          Add at least two people to see how your network connects. Each person
          becomes a node; shared context and relationships become the edges
          between them.
        </p>

        <Link
          href="/people/new"
          style={{
            display: 'inline-block',
            background: 'var(--brand)',
            color: 'var(--text-on-accent)',
            borderRadius: 'var(--radius-pill)',
            padding: '11px 28px',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            textDecoration: 'none',
            boxShadow: 'var(--shadow-md), var(--glow-brand)',
            transition: `background var(--dur-fast)`,
          }}
        >
          {peopleCount === 0 ? 'Add your first person' : 'Add another person'}
        </Link>

        {peopleCount === 1 && (
          <Link
            href="/people"
            style={{
              marginTop: 14,
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-sm)',
              color: 'var(--star-dim)',
              textDecoration: 'none',
              display: 'block',
            }}
          >
            View people
          </Link>
        )}
      </div>
    );
  }

  return (
    <div style={{ height: 'calc(100dvh - var(--nav-height))' }}>
      <Constellation />
    </div>
  );
}
