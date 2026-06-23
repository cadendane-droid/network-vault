import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Nav from '@/components/nav';
import { CaptureProvider } from '@/components/capture-animation';
import { provisionUser } from '@/lib/provisionUser';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    redirect('/sign-in');
  }

  // Universal authenticated entry point — the single provisioning path
  // (find-or-create + account_created on first create only) runs here.
  const clerkUser = await currentUser();
  await provisionUser(clerkId, clerkUser);

  return (
    <CaptureProvider>
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
    </CaptureProvider>
  );
}
