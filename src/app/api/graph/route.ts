import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [people, rawEdges] = await Promise.all([
    // DM §7.2 — active people as nodes.
    // Pull fact statuses inline so we can derive factCount and hasConfirmedFacts
    // in a single round-trip rather than two separate queries.
    prisma.people.findMany({
      where: { user_id: user.userId, status: 'active' },
      select: {
        id: true,
        name: true,
        facts: {
          where: { status: { in: ['raw', 'confirmed'] } },
          select: { status: true, type: true, value: true },
          // confirmed < raw alphabetically → ASC puts confirmed first so
          // find() below returns a confirmed fact before a raw one.
          orderBy: [{ status: 'asc' }],
        },
      },
    }),

    // DM §7.2 — all edges for the user (both directions are stored once;
    // react-force-graph-2d treats them as undirected so order doesn't matter).
    prisma.edge.findMany({
      where: { user_id: user.userId },
      select: {
        person_a: true,
        person_b: true,
        relationship_type: true,
        status: true,
      },
    }),
  ]);

  const nodes = people.map((p) => ({
    id: p.id,
    name: p.name,
    factCount: p.facts.length,
    hasConfirmedFacts: p.facts.some((f) => f.status === 'confirmed'),
    // First role/org fact (confirmed preferred over raw due to orderBy above).
    // Included so the node bottom sheet can show context without a second fetch.
    role: p.facts.find((f) => f.type === 'role')?.value ?? null,
    org: p.facts.find((f) => f.type === 'org')?.value ?? null,
  }));

  // Rename person_a / person_b → source / target for react-force-graph-2d.
  const edges = rawEdges.map((e) => ({
    source: e.person_a,
    target: e.person_b,
    relationship_type: e.relationship_type,
    status: e.status,
  }));

  return NextResponse.json({ nodes, edges });
}
