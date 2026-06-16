import { inngest } from '@/inngest/client';
import prisma from '@/lib/prisma';
import { embedText } from '@/lib/claude';
import { captureServerEvent } from '@/lib/posthog-server';

function log(stage: string, data: Record<string, unknown>) {
  console.log(`[embed] ${stage} ${JSON.stringify(data)}`);
}

export const embedPersonFacts = inngest.createFunction(
  {
    id: 'embed-person-facts',
    name: 'Embed facts for semantic search',
    triggers: [{ event: 'vault/facts.extracted' }],
    // Terminal-status guarantee, same as the extract job: if embedding fails
    // after all retries, move the source to 'failed' so the UI surfaces it and
    // a reprocess can recover it. (Facts written by extract remain visible on
    // the profile; only semantic search is degraded until reprocess.)
    onFailure: async ({ event, error, step }) => {
      const original = event.data.event.data as { source_id?: string };
      const source_id = original?.source_id;
      console.error(
        `[embed] FAILED ${JSON.stringify({ source_id, error: error.message })}`
      );
      if (source_id) {
        await step.run('mark-failed', () =>
          prisma.source.update({
            where: { id: source_id },
            data: { processing_status: 'failed' },
          })
        );
      }
    },
  },
  async ({ event, step }) => {
    const { person_id, source_id, user_id, facts_count, edges_count } =
      event.data as {
        person_id: string;
        source_id: string;
        user_id: string;
        facts_count?: number;
        edges_count?: number;
      };
    log('start', { person_id, source_id, user_id });

    // ── Step 1: Fetch unembedded facts for this source ──────────────────────
    // Raw query required — embedding is Unsupported("vector(1024)") and
    // cannot be used in Prisma's findMany where clause.
    const facts = await step.run(
      'fetch-facts',
      () =>
        prisma.$queryRaw<Array<{ id: string; value: string }>>`
        SELECT id, value FROM facts
        WHERE source_id = ${source_id}::uuid
        AND embedding IS NULL
      `
    );
    log('facts-to-embed', { source_id, count: facts.length });

    // ── Step 2: Embed each fact — one step.run per fact ─────────────────────
    // Each fact is its own Inngest step so failures are retried independently.
    // A single monolithic loop step would abort the entire batch on the first
    // failed embedText() call, leaving remaining facts with null embeddings.
    // Raw SQL required for the write — prisma.fact.update errors on Unsupported fields.
    let embedded = 0;
    for (const fact of facts) {
      const dim = await step.run(`embed-fact-${fact.id}`, async () => {
        const vector = await embedText(fact.value);
        await prisma.$executeRaw`
          UPDATE facts
          SET embedding = ${JSON.stringify(vector)}::vector
          WHERE id = ${fact.id}::uuid
        `;
        return vector.length;
      });
      log('embedded-fact', { source_id, fact_id: fact.id, dim });
      embedded++;
    }

    // ── Step 3: Compute shared_interest edges ────────────────────────────────
    // shared_interest is the only edge type not extracted by Claude — it is
    // computed here by matching exact interest fact values across the vault.
    const sharedInterestsCreated = await step.run(
      'compute-shared-interests',
      async () => {
        const interestFacts = await prisma.fact.findMany({
          where: { source_id, type: 'interest' },
          select: { person_id: true, value: true },
        });

        let count = 0;
        for (const { person_id, value } of interestFacts) {
          // Find other people in this vault with the same interest value
          const matches = await prisma.fact.findMany({
            where: {
              type: 'interest',
              value,
              person_id: { not: person_id },
              person: { user_id },
            },
            select: { person_id: true },
            distinct: ['person_id'],
          });

          for (const match of matches) {
            const existing = await prisma.edge.findFirst({
              where: {
                relationship_type: 'shared_interest',
                OR: [
                  { person_a: person_id, person_b: match.person_id },
                  { person_a: match.person_id, person_b: person_id },
                ],
              },
              select: { id: true },
            });

            if (!existing) {
              await prisma.edge.create({
                data: {
                  user_id,
                  person_a: person_id,
                  person_b: match.person_id,
                  relationship_type: 'shared_interest',
                  source_id,
                  status: 'inferred',
                },
              });
              count++;
            }
          }
        }
        return count;
      }
    );

    // ── Step 4: Mark source complete — the true end of processing ────────────
    // Both extraction and embedding have now succeeded. This is the only place
    // a source becomes 'complete', so the spinner only clears when the profile
    // is genuinely query-ready.
    await step.run('mark-complete', () =>
      prisma.source.update({
        where: { id: source_id },
        data: { processing_status: 'complete' },
      })
    );

    // ── Step 5: Analytics ────────────────────────────────────────────────────
    // Distinct ID must be the Clerk ID — that's what the browser client
    // identifies with — so look it up from the DB user id in the event.
    await step.run('capture-processing-completed', async () => {
      const dbUser = await prisma.user.findUnique({
        where: { id: user_id },
        select: { clerk_id: true },
      });
      await captureServerEvent(
        dbUser?.clerk_id ?? user_id,
        'processing_completed',
        {
          person_id,
          source_id,
          facts_count: facts_count ?? null,
          edges_count: edges_count ?? null,
          embedded,
          shared_interests_count: sharedInterestsCreated,
        }
      );
    });

    log('complete', { source_id, embedded, sharedInterestsCreated });
    return { source_id, embedded, sharedInterestsCreated };
  }
);
