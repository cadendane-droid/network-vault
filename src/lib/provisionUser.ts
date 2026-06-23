import { Prisma } from '@/generated/prisma/client';
import prisma from '@/lib/prisma';
import { captureServerEvent } from '@/lib/posthog-server';

// Minimal structural shape of Clerk's currentUser() — kept loose so this util
// isn't coupled to a specific @clerk/backend export.
interface ClerkUserShape {
  emailAddresses: { emailAddress: string }[];
  externalAccounts: { provider: string }[];
  passwordEnabled: boolean;
}

// Categorical sign-up method for account_created (e.g. 'google', 'email').
// PII-free by construction — only the provider *name*, never providerUserId or
// an email. Returns null when it can't be determined.
function deriveAuthProvider(user: ClerkUserShape): string | null {
  const external = user.externalAccounts?.[0]?.provider;
  if (external) return external;
  if (user.passwordEnabled) return 'email';
  return null;
}

/**
 * The single provisioning path for the users row (D3). find-or-create by
 * clerk_id; emits `account_created` exactly once, on the real DB create.
 *
 * Race-safe: if a concurrent provision wins the insert and our create trips the
 * unique constraint on clerk_id (P2002), we treat the row as already-existing
 * and DO NOT emit account_created — so a returning/duplicate request can never
 * produce a spurious sign-up event.
 */
export async function provisionUser(
  clerkId: string,
  clerkUser: ClerkUserShape | null
): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({
    where: { clerk_id: clerkId },
    select: { id: true },
  });
  if (existing) return existing;

  const email = clerkUser?.emailAddresses?.[0]?.emailAddress ?? '';

  try {
    const created = await prisma.user.create({
      data: { clerk_id: clerkId, email, plan: 'free' },
      select: { id: true },
    });

    // Fired only here — the create branch — so it marks genuine sign-ups, never
    // sign-ins. Properties are PII-free: the auth-provider enum only, and only
    // when known (otherwise no properties).
    const authProvider = clerkUser ? deriveAuthProvider(clerkUser) : null;
    await captureServerEvent(
      clerkId,
      'account_created',
      authProvider ? { auth_provider: authProvider } : {}
    );

    return created;
  } catch (err) {
    // Concurrent insert won the race (unique violation on clerk_id). Re-read and
    // return the existing row WITHOUT emitting account_created.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const row = await prisma.user.findUnique({
        where: { clerk_id: clerkId },
        select: { id: true },
      });
      if (row) return row;
    }
    throw err;
  }
}
