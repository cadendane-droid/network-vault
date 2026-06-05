import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { extractPersonFacts } from '@/inngest/functions/extract';
import { embedPersonFacts } from '@/inngest/functions/embed';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [extractPersonFacts, embedPersonFacts],
});
