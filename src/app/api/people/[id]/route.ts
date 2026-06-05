import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const person = await prisma.people.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      created_at: true,
      user_id: true,
    },
  });

  if (!person || person.user_id !== user.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [facts, conversations, edges] = await Promise.all([
    // DM §7.3 — facts query: status IN (raw, confirmed), confirmed first
    prisma.fact.findMany({
      where: {
        person_id: id,
        status: { in: ['raw', 'confirmed'] },
      },
      select: {
        id: true,
        type: true,
        value: true,
        status: true,
        source_id: true,
        created_at: true,
      },
      orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
    }),

    // DM §7.3 — conversations query via join table
    prisma.conversation.findMany({
      where: {
        participants: { some: { person_id: id } },
      },
      select: { id: true, date: true, summary: true },
      orderBy: { date: 'desc' },
    }),

    // DM §7.3 — edges query: both directions
    prisma.edge.findMany({
      where: {
        OR: [{ person_a: id }, { person_b: id }],
      },
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
  ]);

  const connections = edges.map((e) => {
    const connected = e.person_a === id ? e.personB : e.personA;
    return {
      id: e.id,
      relationship_type: e.relationship_type,
      status: e.status,
      connected_person_id: connected.id,
      connected_person_name: connected.name,
    };
  });

  return NextResponse.json({
    id: person.id,
    name: person.name,
    status: person.status,
    created_at: person.created_at,
    facts,
    conversations,
    connections,
  });
}
