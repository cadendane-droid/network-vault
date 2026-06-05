import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function POST() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await currentUser();

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const email = user.emailAddresses[0]?.emailAddress ?? '';

  const dbUser = await prisma.user.upsert({
    where: { clerk_id: userId },
    update: {},
    create: {
      clerk_id: userId,
      email,
      plan: 'free',
    },
  });

  return NextResponse.json(dbUser, { status: 200 });
}
