import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import prisma from '@/lib/prisma';

// Stripe sends the raw body for signature verification. Next.js App Router
// does not pre-parse API route bodies, so request.text() returns the raw
// payload — exactly what constructEvent needs.
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    );
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Signature verification failed';
    console.error('[stripe webhook] verification failed:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    switch (event.type) {
      // -----------------------------------------------------------------------
      // Checkout completed → set plan to pro and store the Stripe customer ID.
      // This is the primary upgrade event. client_reference_id = clerk_id was
      // set when the session was created, giving us a reliable user mapping.
      // -----------------------------------------------------------------------
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const clerkId = session.client_reference_id;
        const customerId =
          typeof session.customer === 'string'
            ? session.customer
            : ((session.customer as Stripe.Customer | null)?.id ?? null);

        if (!clerkId || !customerId) {
          console.error(
            '[stripe webhook] checkout.session.completed missing clerkId or customerId'
          );
          break;
        }

        await prisma.user.update({
          where: { clerk_id: clerkId },
          data: {
            plan: 'pro',
            stripe_customer_id: customerId,
          },
        });
        break;
      }

      // -----------------------------------------------------------------------
      // Subscription updated → sync plan to current subscription status.
      // Covers: plan changes, payment failures, reactivations.
      // -----------------------------------------------------------------------
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

        // active or trialing = keep / restore pro; anything else = downgrade.
        const isPro = sub.status === 'active' || sub.status === 'trialing';

        await prisma.user.updateMany({
          where: { stripe_customer_id: customerId },
          data: { plan: isPro ? 'pro' : 'free' },
        });
        break;
      }

      // -----------------------------------------------------------------------
      // Subscription deleted → downgrade to free.
      // Fires when a subscription is fully cancelled (not just past_due).
      // -----------------------------------------------------------------------
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

        await prisma.user.updateMany({
          where: { stripe_customer_id: customerId },
          data: { plan: 'free' },
        });
        break;
      }

      default:
        // Unhandled event types are silently acknowledged — Stripe retries
        // on non-2xx responses, so we always return 200 for unknown types.
        break;
    }
  } catch (err) {
    console.error('[stripe webhook] handler error:', err);
    return NextResponse.json(
      { error: 'Internal handler error' },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
