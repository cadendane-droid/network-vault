import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import PersonCard from '@/components/person-card';

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
          facts: { where: { status: 'confirmed' } },
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
    confirmed_fact_count: p._count.facts,
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

  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-semibold text-zinc-900">People</h1>
        <Link
          href="/people/new"
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
        >
          Add
        </Link>
      </div>

      {people.length === 0 ? (
        <div className="flex flex-col items-center gap-3 pt-16 text-center">
          <p className="text-zinc-500">No one in your vault yet.</p>
          <Link
            href="/people/new"
            className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white"
          >
            Add your first person
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {people.map((p) => (
            <li key={p.id}>
              <PersonCard {...p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
