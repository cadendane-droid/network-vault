import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { isAdminClerkId } from '@/lib/admin';
import { reprocessSource } from '@/lib/reprocess';

// Admin-only recovery for a stuck/failed source belonging to ANY user.
// Body: { source_id: string, person_id: string }
// Guarded by ADMIN_CLERK_IDS (src/lib/admin.ts), like GET /api/feedback.
export async function POST(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isAdminClerkId(user.clerkId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { source_id, person_id } = body as Record<string, unknown>;
  if (typeof source_id !== 'string' || typeof person_id !== 'string') {
    return NextResponse.json(
      { error: 'source_id and person_id are required' },
      { status: 400 }
    );
  }

  const [source, person] = await Promise.all([
    prisma.source.findUnique({
      where: { id: source_id },
      select: { user_id: true },
    }),
    prisma.people.findUnique({
      where: { id: person_id },
      select: { user_id: true },
    }),
  ]);

  if (!source) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }
  if (!person) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 });
  }
  // Both must belong to the same owner — guards against cross-user mixups.
  if (source.user_id !== person.user_id) {
    return NextResponse.json(
      { error: 'source and person belong to different users' },
      { status: 400 }
    );
  }

  await reprocessSource({
    sourceId: source_id,
    personId: person_id,
    userId: source.user_id,
  });

  return NextResponse.json({ ok: true, source_id, person_id });
}
