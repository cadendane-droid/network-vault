import Stripe from 'stripe';

// Singleton Stripe client. Uses the server-only secret key — never expose
// this to the client bundle. The apiVersion is pinned so behaviour doesn't
// change when Stripe releases a new default.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export default stripe;
