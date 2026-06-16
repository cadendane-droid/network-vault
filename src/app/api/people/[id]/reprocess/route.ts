import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { reprocessSource } from '@/lib/reprocess';

// Owner-triggered retry, called by the "Try again" action on a failed profile.
// Re-runs extraction + embedding for this person's most recent source.
// Re-uses the V1 "most recent source for the user" heuristic that the status
// endpoint and profile page already rely on (Source has no person_id FK yet).
export async function POST(
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
    select: { user_id: true },
  });
  if (!person || person.user_id !== user.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const source = await prisma.source.findFirst({
    where: { user_id: user.userId },
    orderBy: { created_at: 'desc' },
    select: { id: true },
  });
  if (!source) {
    return NextResponse.json(
      { error: 'No source to reprocess' },
      { status: 404 }
    );
  }

  await reprocessSource({
    sourceId: source.id,
    personId: id,
    userId: user.userId,
  });

  return NextResponse.json({ ok: true });
}
