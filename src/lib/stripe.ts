import Stripe from 'stripe';

// Lazily-initialised singleton. The client is only created when getStripe()
// is first called inside a route handler at runtime — never at module import
// time during the Next.js build, when STRIPE_SECRET_KEY isn't available.
let _instance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_instance) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }
    _instance = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _instance;
}
