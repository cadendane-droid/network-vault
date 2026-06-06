import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import prisma from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';

export async function POST(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { email: true, stripe_customer_id: true, plan: true },
  });

  if (!dbUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (dbUser.plan === 'pro') {
    return NextResponse.json({ error: 'Already on Pro plan' }, { status: 400 });
  }

  // Derive redirect URLs from the request origin so this works in both
  // local development and production without an extra env variable.
  const origin = request.headers.get('origin') ?? 'http://localhost:3000';

  // Find or create the Stripe customer for this user. We store the ID in
  // the DB so future webhooks can map Stripe customer → our user row.
  const stripe = getStripe();
  let stripeCustomerId = dbUser.stripe_customer_id;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: dbUser.email,
      metadata: { clerk_id: user.clerkId },
    });
    stripeCustomerId = customer.id;
    await prisma.user.update({
      where: { id: user.userId },
      data: { stripe_customer_id: stripeCustomerId },
    });
  }

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    // client_reference_id is a backup mapping — used in checkout.session.completed
    // if stripe_customer_id isn't already stored (e.g. on first-ever checkout).
    client_reference_id: user.clerkId,
    mode: 'subscription',
    line_items: [
      {
        price: process.env.STRIPE_PRICE_ID!,
        quantity: 1,
      },
    ],
    success_url: `${origin}/account?upgraded=true`,
    cancel_url: `${origin}/account`,
  });

  return NextResponse.json({ url: session.url });
}
