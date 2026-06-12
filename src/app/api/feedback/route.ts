import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { isAdminClerkId } from '@/lib/admin';

const FEEDBACK_MESSAGE_LIMIT = 2000;

// Privacy: never log the message body — same rule as raw_text.
// Feedback is free and unmetered: no usage counter is read or written here.
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

  const { message, page, user_agent } = body as Record<string, unknown>;

  if (!message || typeof message !== 'string' || message.trim() === '') {
    return NextResponse.json(
      {
        error: 'MESSAGE_REQUIRED',
        message: 'Feedback message is required.',
      },
      { status: 400 }
    );
  }
  if (message.trim().length > FEEDBACK_MESSAGE_LIMIT) {
    return NextResponse.json(
      {
        error: 'MESSAGE_TOO_LONG',
        message: `Feedback must be under ${FEEDBACK_MESSAGE_LIMIT.toLocaleString('en-US')} characters.`,
      },
      { status: 400 }
    );
  }

  await prisma.feedback.create({
    data: {
      user_id: user.userId,
      message: message.trim(),
      page: typeof page === 'string' && page.trim() !== '' ? page.trim() : null,
      user_agent:
        typeof user_agent === 'string' && user_agent.trim() !== ''
          ? user_agent.trim()
          : null,
    },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}

// Admin-only intake: every submission, newest first, with submitter email.
export async function GET() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isAdminClerkId(user.clerkId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = await prisma.feedback.findMany({
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      message: true,
      page: true,
      status: true,
      user_agent: true,
      created_at: true,
      user: { select: { email: true } },
    },
  });

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      message: r.message,
      page: r.page,
      status: r.status,
      user_agent: r.user_agent,
      created_at: r.created_at,
      email: r.user.email,
    }))
  );
}
