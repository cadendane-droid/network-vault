import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'network-vault',
  eventKey: process.env.INNGEST_EVENT_KEY,
});
