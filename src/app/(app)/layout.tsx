import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import Nav from '@/components/nav';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    redirect('/sign-in');
  }

  const clerkUser = await currentUser();
  const email = clerkUser?.emailAddresses[0]?.emailAddress ?? '';

  await prisma.user.upsert({
    where: { clerk_id: clerkId },
    update: {},
    create: {
      clerk_id: clerkId,
      email,
      plan: 'free',
    },
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100svh',
        background: 'var(--surface-canvas)',
      }}
    >
      <main style={{ flex: 1, paddingBottom: 'var(--nav-height)' }}>
        {children}
      </main>
      <Nav />
    </div>
  );
}
