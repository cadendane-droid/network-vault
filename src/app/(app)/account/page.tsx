import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import UpgradeButton from '@/components/upgrade-button';
import {
  PERSON_LIMIT,
  DAILY_UPLOAD_LIMIT,
  DAILY_QUERY_LIMIT,
  MONTHLY_QUERY_LIMIT,
} from '@/lib/limits';
import { currentDailyCount, currentMonthlyCount } from '@/lib/usage';

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ upgraded?: string }>;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerk_id: clerkId },
    select: {
      id: true,
      email: true,
      plan: true,
      daily_upload_count: true,
      daily_upload_reset_at: true,
      daily_query_count: true,
      daily_query_reset_at: true,
      monthly_query_count: true,
      monthly_query_reset_at: true,
    },
  });
  if (!dbUser) redirect('/sign-in');

  // Fetch people count in parallel with searchParams resolution.
  const [{ upgraded }, peopleCount] = await Promise.all([
    searchParams,
    prisma.people.count({ where: { user_id: dbUser.id } }),
  ]);

  const justUpgraded = upgraded === 'true';
  const isPro = dbUser.plan === 'pro';

  // Counters whose window has rolled over read as 0 — the same logic the
  // API gates use, so the display never shows a stale "limit reached".
  const usageRows = [
    { label: 'People', count: peopleCount, limit: PERSON_LIMIT },
    {
      label: 'Uploads today',
      count: currentDailyCount(
        dbUser.daily_upload_count,
        dbUser.daily_upload_reset_at
      ),
      limit: DAILY_UPLOAD_LIMIT,
    },
    {
      label: 'Queries today',
      count: currentDailyCount(
        dbUser.daily_query_count,
        dbUser.daily_query_reset_at
      ),
      limit: DAILY_QUERY_LIMIT,
    },
    {
      label: 'Queries this month',
      count: currentMonthlyCount(
        dbUser.monthly_query_count,
        dbUser.monthly_query_reset_at
      ),
      limit: MONTHLY_QUERY_LIMIT,
    },
  ];

  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold text-zinc-900 mb-6">Account</h1>

      {/* Success banner — shown once after completing Stripe Checkout */}
      {justUpgraded && (
        <div className="mb-4 rounded-xl bg-violet-50 border border-violet-200 px-4 py-3">
          <p className="text-sm font-medium text-violet-800">
            Welcome to Pro! Your vault now has full query access.
          </p>
        </div>
      )}

      {/* Plan card */}
      <div className="rounded-xl border border-zinc-100 bg-white divide-y divide-zinc-100">
        {/* Email row */}
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-zinc-500">Email</span>
          <span className="text-sm text-zinc-900 font-medium truncate ml-4">
            {dbUser.email}
          </span>
        </div>

        {/* Plan row */}
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-zinc-500">Plan</span>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              isPro
                ? 'bg-violet-100 text-violet-700'
                : 'bg-zinc-100 text-zinc-600'
            }`}
          >
            {isPro ? 'Pro' : 'Free'}
          </span>
        </div>

        {/* Usage rows — beta caps apply to every account */}
        {usageRows.map(({ label, count, limit }) => (
          <div
            key={label}
            className="px-4 py-3 flex items-center justify-between"
          >
            <span className="text-sm text-zinc-500">{label}</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-900 font-medium">
                {count} / {limit}
              </span>
              <div className="w-16 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    count >= limit
                      ? 'bg-red-400'
                      : count >= limit * 0.8
                        ? 'bg-amber-400'
                        : 'bg-violet-500'
                  }`}
                  style={{
                    width: `${Math.min(100, (count / limit) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>
        ))}

        {/* Action row */}
        <div className="px-4 py-4">
          {isPro ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-500">
                You&apos;re on the Pro plan. All features are unlocked.
              </p>
              <UpgradeButton
                action="portal"
                className="text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-900 transition-colors"
              >
                Manage billing
              </UpgradeButton>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  Upgrade to Pro
                </p>
                <p className="mt-0.5 text-sm text-zinc-500">
                  Unlock unlimited queries and priority processing.
                </p>
              </div>
              <UpgradeButton
                action="upgrade"
                className="inline-flex rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Upgrade to Pro
              </UpgradeButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
