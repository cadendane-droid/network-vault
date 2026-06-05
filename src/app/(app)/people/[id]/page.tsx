import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import prisma from '@/lib/prisma';

async function getPersonProfile(personId: string, userId: string) {
  const person = await prisma.people.findUnique({
    where: { id: personId },
    select: {
      id: true,
      name: true,
      status: true,
      created_at: true,
      user_id: true,
    },
  });

  if (!person || person.user_id !== userId) return null;

  const [facts, conversations, edges, latestSource] = await Promise.all([
    prisma.fact.findMany({
      where: { person_id: personId, status: { in: ['raw', 'confirmed'] } },
      select: {
        id: true,
        type: true,
        value: true,
        status: true,
        created_at: true,
      },
      orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
    }),
    prisma.conversation.findMany({
      where: { participants: { some: { person_id: personId } } },
      select: { id: true, date: true, summary: true },
      orderBy: { date: 'desc' },
    }),
    prisma.edge.findMany({
      where: { OR: [{ person_a: personId }, { person_b: personId }] },
      select: {
        id: true,
        relationship_type: true,
        status: true,
        person_a: true,
        person_b: true,
        personA: { select: { id: true, name: true } },
        personB: { select: { id: true, name: true } },
      },
    }),
    prisma.source.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: { processing_status: true, raw_text: true },
    }),
  ]);

  const factsByType = facts.reduce<Record<string, typeof facts>>(
    (acc, f) => ({ ...acc, [f.type]: [...(acc[f.type] ?? []), f] }),
    {}
  );

  const connections = edges.map((e) => {
    const connected = e.person_a === personId ? e.personB : e.personA;
    return {
      id: e.id,
      relationship_type: e.relationship_type,
      status: e.status,
      connected_person_id: connected.id,
      connected_person_name: connected.name,
    };
  });

  return { person, factsByType, conversations, connections, latestSource };
}

const TYPE_LABELS: Record<string, string> = {
  role: 'Role',
  org: 'Organisation',
  location: 'Location',
  interest: 'Interests',
  background: 'Background',
  context: 'How you know them',
  connection: 'Connections',
  quote: 'Quotes',
};

export default async function PersonProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerk_id: clerkId },
    select: { id: true },
  });
  if (!dbUser) redirect('/sign-in');

  const { id } = await params;
  const data = await getPersonProfile(id, dbUser.id);
  if (!data) notFound();

  const { person, factsByType, conversations, connections, latestSource } =
    data;
  const isProcessing =
    latestSource?.processing_status === 'pending' ||
    latestSource?.processing_status === 'processing';

  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">{person.name}</h1>
        {isProcessing && (
          <p className="mt-1 text-sm text-zinc-500">
            Extracting facts… this usually takes a few seconds.
          </p>
        )}
      </div>

      {/* Facts by type */}
      {Object.keys(factsByType).length > 0 && (
        <section className="space-y-4">
          {Object.entries(factsByType).map(([type, typeFacts]) => (
            <div key={type}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                {TYPE_LABELS[type] ?? type}
              </h2>
              <ul className="space-y-1">
                {typeFacts.map((f) => (
                  <li key={f.id} className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        f.status === 'confirmed' ? 'bg-zinc-900' : 'bg-zinc-300'
                      }`}
                    />
                    <span className="text-sm text-zinc-700">{f.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {/* Empty facts state */}
      {Object.keys(factsByType).length === 0 && !isProcessing && (
        <p className="text-sm text-zinc-400">
          No facts extracted yet. Try adding more notes.
        </p>
      )}

      {/* Conversations */}
      {conversations.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
            Conversations
          </h2>
          <ul className="space-y-3">
            {conversations.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-zinc-100 bg-white p-3"
              >
                <p className="text-xs text-zinc-400">
                  {new Date(c.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
                {c.summary && (
                  <p className="mt-1 text-sm text-zinc-700">{c.summary}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Connections */}
      {connections.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
            Connections
          </h2>
          <ul className="space-y-2">
            {connections.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-zinc-900">{c.connected_person_name}</span>
                <span className="text-xs text-zinc-400">
                  {c.relationship_type.replace('_', ' ')}
                  {c.status === 'inferred' ? ' · inferred' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Raw text */}
      {latestSource?.raw_text && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-600 list-none flex items-center gap-1">
            <svg
              className="w-3 h-3 transition-transform group-open:rotate-90"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M7.293 4.707a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
            Show original notes
          </summary>
          <p className="mt-2 text-sm text-zinc-500 whitespace-pre-wrap leading-relaxed">
            {latestSource.raw_text}
          </p>
        </details>
      )}
    </div>
  );
}
