import { inngest } from '@/inngest/client';
import prisma from '@/lib/prisma';
import { extractFromSource, type SourceKind } from '@/lib/claude';
import { EXTRACTION_SYSTEM_PROMPT } from '@/lib/prompts/extraction';
import { validateExtractionOutput } from '@/lib/validation/extraction';

export const extractPersonFacts = inngest.createFunction(
  {
    id: 'extract-person-facts',
    name: 'Extract facts from person source',
    triggers: [{ event: 'vault/person.created' }],
  },
  async ({ event, step }) => {
    const { person_id, source_id, user_id } = event.data as {
      person_id: string;
      source_id: string;
      user_id: string;
    };

    // ── Step 1: Fetch source and primary person ─────────────────────────────
    const { source, primaryPerson } = await step.run(
      'fetch-source',
      async () => {
        const [source, primaryPerson] = await Promise.all([
          prisma.source.findUnique({
            where: { id: source_id },
            select: { id: true, raw_text: true, kind: true, date: true },
          }),
          prisma.people.findUnique({
            where: { id: person_id },
            select: { id: true, name: true },
          }),
        ]);
        return { source, primaryPerson };
      }
    );

    if (!source || !primaryPerson) {
      await prisma.source.update({
        where: { id: source_id },
        data: { processing_status: 'failed' },
      });
      throw new Error(
        `Source or person not found — source=${source_id} person=${person_id}`
      );
    }

    // ── Step 2: Call Claude ─────────────────────────────────────────────────
    let extraction: Awaited<ReturnType<typeof extractFromSource>>;
    try {
      extraction = await step.run('call-claude', () =>
        extractFromSource(
          source.raw_text,
          source.kind as SourceKind,
          EXTRACTION_SYSTEM_PROMPT,
          primaryPerson.name // lets Claude resolve pronouns to the right name
        )
      );
    } catch (err) {
      await prisma.source.update({
        where: { id: source_id },
        data: { processing_status: 'failed' },
      });
      throw err;
    }

    // ── Step 3: Validate ────────────────────────────────────────────────────
    const { validFacts, validEdges, invalid } = await step.run('validate', () =>
      validateExtractionOutput(extraction, source.kind as SourceKind)
    );

    if (invalid.length > 0) {
      console.warn(
        `[extract] ${invalid.length} invalid item(s) skipped for source ${source_id}:`,
        invalid
      );
    }

    // ── Step 4: Resolve person names → IDs ─────────────────────────────────
    const personIdMap = await step.run('resolve-people', async () => {
      const allNames = new Set([
        ...validFacts.map((f) => f.person_name),
        ...validEdges.flatMap((e) => [e.person_a, e.person_b]),
        ...(extraction.conversation?.participants ?? []),
      ]);

      // Seed with the primary person from the event
      const map: Record<string, string> = {
        [primaryPerson.name.toLowerCase()]: primaryPerson.id,
      };

      // Fetch all existing people for this user to avoid duplicates
      const existing = await prisma.people.findMany({
        where: { user_id },
        select: { id: true, name: true },
      });
      for (const p of existing) {
        map[p.name.toLowerCase()] = p.id;
      }

      // Create rows for names not already in the vault
      for (const name of allNames) {
        const key = name.toLowerCase();
        if (!map[key]) {
          const created = await prisma.people.create({
            data: { user_id, name },
            select: { id: true },
          });
          map[key] = created.id;
        }
      }

      return map;
    });

    // ── Step 5: Write facts ─────────────────────────────────────────────────
    const factsWritten = await step.run('write-facts', async () => {
      let count = 0;
      for (const fact of validFacts) {
        const factPersonId = personIdMap[fact.person_name.toLowerCase()];
        if (!factPersonId) continue;
        await prisma.fact.create({
          data: {
            person_id: factPersonId,
            source_id,
            type: fact.type,
            value: fact.value,
            status: 'raw',
          },
        });
        count++;
      }
      return count;
    });

    // ── Step 6: Write edges (with dedup) ────────────────────────────────────
    const edgesWritten = await step.run('write-edges', async () => {
      let count = 0;
      for (const edge of validEdges) {
        const aId = personIdMap[edge.person_a.toLowerCase()];
        const bId = personIdMap[edge.person_b.toLowerCase()];
        if (!aId || !bId) continue;

        // Check for existing edge in either direction with the same type
        const existing = await prisma.edge.findFirst({
          where: {
            relationship_type: edge.relationship_type,
            OR: [
              { person_a: aId, person_b: bId },
              { person_a: bId, person_b: aId },
            ],
          },
          select: { id: true },
        });

        if (existing) {
          await prisma.edge.update({
            where: { id: existing.id },
            data: { status: 'confirmed' },
          });
        } else {
          await prisma.edge.create({
            data: {
              user_id,
              person_a: aId,
              person_b: bId,
              relationship_type: edge.relationship_type,
              source_id,
              status: 'inferred',
            },
          });
          count++;
        }
      }
      return count;
    });

    // ── Step 7: Write conversation (conversation sources only) ───────────────
    if (source.kind === 'conversation' && extraction.conversation) {
      await step.run('write-conversation', async () => {
        const conv = await prisma.conversation.create({
          data: {
            user_id,
            source_id,
            summary: extraction.conversation!.summary,
            date: source.date,
          },
          select: { id: true },
        });

        const participants = extraction.conversation!.participants;
        if (participants.length > 0) {
          const participantData = participants
            .map((name) => ({
              conversation_id: conv.id,
              person_id: personIdMap[name.toLowerCase()],
            }))
            .filter((p): p is { conversation_id: string; person_id: string } =>
              Boolean(p.person_id)
            );

          await prisma.conversationParticipant.createMany({
            data: participantData,
            skipDuplicates: true,
          });
        }
      });
    }

    // ── Step 8: Mark source complete ────────────────────────────────────────
    await step.run('mark-complete', () =>
      prisma.source.update({
        where: { id: source_id },
        data: { processing_status: 'complete' },
      })
    );

    // Fire embed event — Step 32's job picks this up when registered
    await step.sendEvent('send-embed-event', {
      name: 'vault/facts.extracted',
      data: { source_id, user_id },
    });

    return { person_id, source_id, factsWritten, edgesWritten };
  }
);
