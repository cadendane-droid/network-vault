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

  // Verify this person belongs to the authenticated user.
  const person = await prisma.people.findUnique({
    where: { id },
    select: { user_id: true },
  });

  if (!person || person.user_id !== user.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Return the processing_status of the most recent source for this user.
  // V1 heuristic: Source has no direct person_id FK; users submit one person
  // at a time so the most recent source is always the relevant one.
  // Step 34 acceptance note: tighten to person-scoped lookup when source→person
  // linking is added in a later phase.
  const source = await prisma.source.findFirst({
    where: { user_id: user.userId },
    orderBy: { created_at: 'desc' },
    select: { processing_status: true },
  });

  return NextResponse.json({
    status: source?.processing_status ?? 'complete',
  });
}
