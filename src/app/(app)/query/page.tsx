import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import Chat from '@/components/chat';
import EmptyVaultQuery from '@/components/empty-vault-query';

export default async function QueryPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerk_id: clerkId },
    select: { id: true },
  });
  if (!dbUser) redirect('/sign-in');

  const peopleCount = await prisma.people.count({
    where: { user_id: dbUser.id },
  });

  return (
    <div
      style={{
        height: 'calc(100dvh - var(--nav-height))',
        background: 'var(--surface-canvas)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {peopleCount === 0 ? <EmptyVaultQuery /> : <Chat />}
    </div>
  );
}
