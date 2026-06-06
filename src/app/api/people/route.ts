import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { inngest } from '@/inngest/client';

const VALID_KINDS = ['conversation', 'note', 'profile', 'observation'] as const;
type SourceKind = (typeof VALID_KINDS)[number];

function isValidKind(kind: unknown): kind is SourceKind {
  return VALID_KINDS.includes(kind as SourceKind);
}

export async function POST(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Free-tier limit: 25 people maximum (active + archived both count).
  // Pro users have no limit. Check before validation so the error is clear.
  if (user.plan === 'free') {
    const peopleCount = await prisma.people.count({
      where: { user_id: user.userId },
    });
    if (peopleCount >= 25) {
      return NextResponse.json(
        {
          error:
            'Free plan limit reached (25 people). Upgrade to Pro to add unlimited people.',
        },
        { status: 402 }
      );
    }
  }

  const { name, raw_text, source_kind, source_date } = body as Record<
    string,
    unknown
  >;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!raw_text || typeof raw_text !== 'string' || raw_text.trim() === '') {
    return NextResponse.json(
      { error: 'raw_text is required' },
      { status: 400 }
    );
  }
  if (!isValidKind(source_kind)) {
    return NextResponse.json(
      { error: `source_kind must be one of: ${VALID_KINDS.join(', ')}` },
      { status: 400 }
    );
  }

  const date =
    source_date && typeof source_date === 'string'
      ? new Date(source_date)
      : new Date();

  const { person, source } = await prisma.$transaction(async (tx) => {
    const person = await tx.people.create({
      data: {
        user_id: user.userId,
        name: name.trim(),
      },
    });

    const source = await tx.source.create({
      data: {
        user_id: user.userId,
        kind: source_kind,
        raw_text: raw_text.trim(),
        date,
      },
    });

    return { person, source };
  });

  await prisma.source.update({
    where: { id: source.id },
    data: { processing_status: 'processing' },
  });

  await inngest.send({
    name: 'vault/person.created',
    data: {
      person_id: person.id,
      source_id: source.id,
      user_id: user.userId,
    },
  });

  return NextResponse.json(
    { person_id: person.id, source_id: source.id },
    { status: 202 }
  );
}

export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const people = await prisma.people.findMany({
    where: { user_id: user.userId },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      name: true,
      status: true,
      created_at: true,
      _count: {
        select: {
          facts: {
            where: { status: 'confirmed' },
          },
        },
      },
    },
  });

  const result = people.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    created_at: p.created_at,
    confirmed_fact_count: p._count.facts,
  }));

  return NextResponse.json(result);
}
