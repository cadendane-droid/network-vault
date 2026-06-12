import { auth } from '@clerk/nextjs/server';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';

export async function getAuthenticatedUser(request?: NextRequest) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    throw new Error('Unauthorized');
  }

  const user = await prisma.user.findUnique({
    where: { clerk_id: clerkId },
  });

  if (!user) {
    throw new Error('User not found in database');
  }

  return {
    clerkId,
    userId: user.id,
    plan: user.plan,
    daily_upload_count: user.daily_upload_count,
    daily_upload_reset_at: user.daily_upload_reset_at,
    daily_query_count: user.daily_query_count,
    daily_query_reset_at: user.daily_query_reset_at,
    monthly_query_count: user.monthly_query_count,
    monthly_query_reset_at: user.monthly_query_reset_at,
  };
}
