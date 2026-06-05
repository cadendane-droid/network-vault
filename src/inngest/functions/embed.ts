import { inngest } from '@/inngest/client';
import prisma from '@/lib/prisma';
import { embedText } from '@/lib/claude';

export const embedPersonFacts = inngest.createFunction(
  {
    id: 'embed-person-facts',
    name: 'Embed facts for semantic search',
    triggers: [{ event: 'vault/facts.extracted' }],
  },
  async ({ event, step }) => {
    const { source_id, user_id } = event.data as {
      source_id: string;
      user_id: string;
    };

    // ── Step 1: Fetch unembedded facts for this source ──────────────────────
    // Raw query required — embedding is Unsupported("vector(1536)") and
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

    // ── Step 2: Embed each fact — one step.run per fact ─────────────────────
    // Each fact is its own Inngest step so failures are retried independently.
    // A single monolithic loop step would abort the entire batch on the first
    // failed embedText() call, leaving remaining facts with null embeddings.
    // Raw SQL required for the write — prisma.fact.update errors on Unsupported fields.
    let embedded = 0;
    for (const fact of facts) {
      await step.run(`embed-fact-${fact.id}`, async () => {
        const vector = await embedText(fact.value);
        await prisma.$executeRaw`
          UPDATE facts
          SET embedding = ${JSON.stringify(vector)}::vector
          WHERE id = ${fact.id}::uuid
        `;
      });
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

    // ── Step 4: Safety update ────────────────────────────────────────────────
    // Source is already 'complete' from the extract job — this is a no-op guard.
    await step.run('mark-complete', () =>
      prisma.source.update({
        where: { id: source_id },
        data: { processing_status: 'complete' },
      })
    );

    return { source_id, embedded, sharedInterestsCreated };
  }
);
