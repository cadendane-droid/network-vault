import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { invalidateContext } from '@/lib/vault-cache';

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

export async function DELETE(
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

  // Confirm the person exists and belongs to this user before touching anything.
  const person = await prisma.people.findUnique({
    where: { id },
    select: { user_id: true },
  });

  if (!person) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (person.user_id !== user.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // ── Pre-fetch before any deletes ────────────────────────────────────────
      // Collect all source IDs linked to this person (via their facts and via
      // their conversations) before any rows are deleted — we lose the linkage
      // once facts and conversation_participants are gone.
      const [factSourceRows, participations] = await Promise.all([
        tx.fact.findMany({
          where: { person_id: id },
          select: { source_id: true },
        }),
        tx.conversationParticipant.findMany({
          where: { person_id: id },
          select: {
            conversation_id: true,
            conversation: { select: { source_id: true } },
          },
        }),
      ]);

      const conversationIds = participations.map((p) => p.conversation_id);

      // Union of source IDs from facts and from conversations.
      const candidateSourceIds = [
        ...new Set([
          ...factSourceRows.map((f) => f.source_id),
          ...participations.map((p) => p.conversation.source_id),
        ]),
      ];

      // Safety filter: exclude any source that another person's facts still
      // reference. Deleting such a source would violate the facts.source_id FK
      // and would silently remove evidence from other people's profiles.
      let sourceIdsToDelete: string[] = [];
      if (candidateSourceIds.length > 0) {
        const sharedRows = await tx.fact.findMany({
          where: {
            source_id: { in: candidateSourceIds },
            person_id: { not: id },
          },
          select: { source_id: true },
          distinct: ['source_id'],
        });
        const sharedSourceSet = new Set(sharedRows.map((r) => r.source_id));
        sourceIdsToDelete = candidateSourceIds.filter(
          (sid) => !sharedSourceSet.has(sid)
        );
      }

      // ── Deletions — FK-safe order ────────────────────────────────────────────
      // Dependency chain:
      //   facts            → people (person_id), sources (source_id)
      //   conv_participants → conversations (conversation_id), people (person_id)
      //   conversations    → sources (source_id)
      //   edges            → people (person_a/b), sources (source_id)
      //   sources          → users (user_id) — no child refs once above are gone
      //   people           → users (user_id)
      //
      // edges.source_id → sources.id means edges MUST be deleted before sources.

      // 1. facts belonging to the deleted person
      await tx.fact.deleteMany({ where: { person_id: id } });

      // 2. conversation participants for the deleted person
      await tx.conversationParticipant.deleteMany({ where: { person_id: id } });

      // 3. conversations that belong to this person's sources
      if (conversationIds.length > 0) {
        await tx.conversation.deleteMany({
          where: { id: { in: conversationIds } },
        });
      }

      // 4. edges — must precede sources because edges.source_id → sources.id
      await tx.edge.deleteMany({
        where: { OR: [{ person_a: id }, { person_b: id }] },
      });

      // 5. sources (safe now that facts, conversations, and edges no longer
      // reference them; shared sources were excluded in the filter above)
      if (sourceIdsToDelete.length > 0) {
        await tx.source.deleteMany({
          where: { id: { in: sourceIdsToDelete } },
        });
      }

      // 6. the person row itself
      await tx.people.delete({ where: { id } });
    });
  } catch (err) {
    console.error('[delete person] transaction failed:', err);
    return NextResponse.json(
      { error: 'Deletion failed. Please try again.' },
      { status: 500 }
    );
  }

  // Rebuild vault context on next query — the deleted person must not appear.
  invalidateContext(user.userId);

  return NextResponse.json({ success: true });
}
