import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { provisionUser } from '@/lib/provisionUser';

export async function POST() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await currentUser();

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Same single provisioning path as the app layout — find-or-create, with
  // account_created emitted once on the real create only.
  const dbUser = await provisionUser(userId, user);

  return NextResponse.json(dbUser, { status: 200 });
}
