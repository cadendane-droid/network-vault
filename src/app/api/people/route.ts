import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { inngest } from '@/inngest/client';
import { captureServerEvent } from '@/lib/posthog-server';
import {
  PERSON_LIMIT,
  SOURCE_TEXT_LIMIT,
  DAILY_UPLOAD_LIMIT,
} from '@/lib/limits';
import { currentDailyCount, utcToday } from '@/lib/usage';

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
  if (raw_text.length > SOURCE_TEXT_LIMIT) {
    return NextResponse.json(
      {
        error: 'TEXT_TOO_LONG',
        message: `Notes must be under ${SOURCE_TEXT_LIMIT.toLocaleString('en-US')} characters.`,
      },
      { status: 400 }
    );
  }
  if (!isValidKind(source_kind)) {
    return NextResponse.json(
      { error: `source_kind must be one of: ${VALID_KINDS.join(', ')}` },
      { status: 400 }
    );
  }

  // Daily upload cap — applies to every source submission, before any write.
  const now = new Date();
  const uploadsToday = currentDailyCount(
    user.daily_upload_count,
    user.daily_upload_reset_at,
    now
  );
  if (uploadsToday >= DAILY_UPLOAD_LIMIT) {
    return NextResponse.json(
      {
        error: 'DAILY_UPLOAD_LIMIT',
        message: 'Daily upload limit reached. Come back tomorrow.',
      },
      { status: 402 }
    );
  }

  const date =
    source_date && typeof source_date === 'string'
      ? new Date(source_date)
      : new Date();

  const existingPerson = await prisma.people.findFirst({
    where: {
      user_id: user.userId,
      name: { equals: name.trim(), mode: 'insensitive' },
    },
    select: { id: true },
  });

  // Beta hard cap on people — applies to every account, but only when a new
  // people row would be created (adding a source to an existing person is
  // governed by the upload cap alone).
  if (!existingPerson) {
    const peopleCount = await prisma.people.count({
      where: { user_id: user.userId },
    });
    if (peopleCount >= PERSON_LIMIT) {
      return NextResponse.json(
        {
          error: 'PEOPLE_LIMIT',
          message: `You've reached the ${PERSON_LIMIT}-person limit for the beta.`,
        },
        { status: 402 }
      );
    }
  }

  let personId: string;
  let sourceId: string;

  if (existingPerson) {
    personId = existingPerson.id;
    const source = await prisma.source.create({
      data: {
        user_id: user.userId,
        kind: source_kind,
        raw_text: raw_text.trim(),
        date,
      },
    });
    sourceId = source.id;
  } else {
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
    personId = person.id;
    sourceId = source.id;

    await captureServerEvent(user.clerkId, 'person_added', {
      person_id: personId,
      source_kind,
    });
  }

  // Source written — count it against today's upload quota. Writing the
  // count and its window date together makes the daily reset implicit.
  await prisma.user.update({
    where: { id: user.userId },
    data: {
      daily_upload_count: uploadsToday + 1,
      daily_upload_reset_at: utcToday(now),
    },
  });

  await prisma.source.update({
    where: { id: sourceId },
    data: { processing_status: 'processing' },
  });

  await inngest.send({
    name: 'vault/person.created',
    data: {
      person_id: personId,
      source_id: sourceId,
      user_id: user.userId,
    },
  });

  await captureServerEvent(user.clerkId, 'source_submitted', {
    person_id: personId,
    source_id: sourceId,
  });

  return NextResponse.json(
    { person_id: personId, source_id: sourceId },
    { status: 201 }
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
            where: { status: { in: ['raw', 'confirmed'] } },
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
    fact_count: p._count.facts,
  }));

  return NextResponse.json(result);
}
