import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import PeopleListWithSearch from '@/components/people-list-with-search';

async function getPeople(userId: string) {
  const rows = await prisma.people.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      name: true,
      status: true,
      created_at: true,
      _count: {
        select: {
          facts: { where: { status: { in: ['raw', 'confirmed'] } } },
        },
      },
      facts: {
        where: { status: { in: ['raw', 'confirmed'] } },
        take: 1,
        select: { id: true },
      },
    },
  });

  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    created_at: p.created_at,
    fact_count: p._count.facts,
    is_processing: p.facts.length === 0,
  }));
}

export default async function PeoplePage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerk_id: clerkId },
    select: { id: true },
  });
  if (!dbUser) redirect('/sign-in');

  const people = await getPeople(dbUser.id);
  const activeCount = people.filter((p) => p.status === 'active').length;

  return (
    <div
      style={{
        maxWidth: 'var(--screen-max)',
        margin: '0 auto',
        paddingBottom: 24,
      }}
    >
      {/* Sticky header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          padding: '58px var(--gutter) 14px',
          background: 'linear-gradient(var(--surface-canvas) 78%, transparent)',
        }}
      >
        {/* Overline */}
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-mono)',
            color: 'var(--text-muted)',
            margin: '0 0 6px',
          }}
        >
          {activeCount} {activeCount === 1 ? 'connection' : 'connections'}
        </p>

        {/* Title row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-h1)',
              fontWeight: 600,
              color: 'var(--text-strong)',
              letterSpacing: 'var(--tracking-tight)',
              margin: 0,
              lineHeight: 'var(--leading-tight)',
            }}
          >
            Your people
          </h1>

          {/* Add button — 44×44px circle */}
          <Link
            href="/people/new"
            aria-label="Add person"
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'var(--brand)',
              color: 'var(--text-on-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none',
              boxShadow: 'var(--shadow-sm)',
              flexShrink: 0,
              fontSize: 24,
              lineHeight: 1,
              transition: `background var(--dur-fast)`,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
          </Link>
        </div>
      </header>

      {/* Empty state */}
      {people.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            paddingTop: 80,
            textAlign: 'center',
            padding: '80px var(--gutter) 0',
          }}
        >
          <p
            style={{
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-base)',
            }}
          >
            No one in your vault yet.
          </p>
          <Link
            href="/people/new"
            style={{
              display: 'inline-block',
              background: 'var(--brand)',
              color: 'var(--text-on-accent)',
              borderRadius: 'var(--radius-pill)',
              padding: '10px 24px',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              textDecoration: 'none',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            Add your first person
          </Link>
        </div>
      ) : (
        <PeopleListWithSearch people={people} />
      )}
    </div>
  );
}
