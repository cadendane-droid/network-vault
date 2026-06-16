import { inngest } from '@/inngest/client';
import prisma from '@/lib/prisma';
import { extractFromSource, type SourceKind } from '@/lib/claude';
import { EXTRACTION_SYSTEM_PROMPT } from '@/lib/prompts/extraction';
import { validateExtractionOutput } from '@/lib/validation/extraction';
import { invalidateContext } from '@/lib/vault-cache';

// Structured, greppable logging — one line per pipeline stage so a failure is
// diagnosable straight from the Inngest/Vercel logs without a replay.
function log(stage: string, data: Record<string, unknown>) {
  console.log(`[extract] ${stage} ${JSON.stringify(data)}`);
}

export const extractPersonFacts = inngest.createFunction(
  {
    id: 'extract-person-facts',
    name: 'Extract facts from person source',
    triggers: [{ event: 'vault/person.created' }],
    // Terminal-status guarantee: this runs exactly once after the function has
    // exhausted all retries. No matter which step threw, the source is moved
    // out of 'processing' into 'failed' so the UI never spins forever.
    onFailure: async ({ event, error, step }) => {
      const original = event.data.event.data as { source_id?: string };
      const source_id = original?.source_id;
      console.error(
        `[extract] FAILED ${JSON.stringify({ source_id, error: error.message })}`
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
    const { person_id, source_id, user_id } = event.data as {
      person_id: string;
      source_id: string;
      user_id: string;
    };
    log('start', { person_id, source_id, user_id });

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

    // A throw here is caught by onFailure, which marks the source 'failed'.
    if (!source || !primaryPerson) {
      throw new Error(
        `Source or person not found — source=${source_id} person=${person_id}`
      );
    }

    // ── Step 2: Call Claude ─────────────────────────────────────────────────
    const extraction = await step.run('call-claude', () =>
      extractFromSource(
        source.raw_text,
        source.kind as SourceKind,
        EXTRACTION_SYSTEM_PROMPT,
        primaryPerson.name // lets Claude resolve pronouns to the right name
      )
    );
    log('claude-done', {
      source_id,
      raw_facts: Array.isArray(extraction.facts) ? extraction.facts.length : 0,
      raw_edges: Array.isArray(extraction.edges) ? extraction.edges.length : 0,
    });

    // ── Step 3: Validate ────────────────────────────────────────────────────
    const { validFacts, validEdges, invalid } = await step.run('validate', () =>
      validateExtractionOutput(extraction, source.kind as SourceKind)
    );
    log('validated', {
      source_id,
      valid_facts: validFacts.length,
      valid_edges: validEdges.length,
      invalid: invalid.length,
    });

    if (invalid.length > 0) {
      console.warn(
        `[extract] ${invalid.length} invalid item(s) skipped for source ${source_id}: ${JSON.stringify(invalid)}`
      );
    }

    // ── Step 4: Resolve person names → IDs ─────────────────────────────────
    // Rule: only the primary person (submitted via the Add Person form and
    // already created by POST /api/people) is guaranteed a vault row.
    // Every other name Claude mentions — connections, participants, people
    // referenced in edges — is looked up against existing vault members only.
    // If the name is not already in the vault, it gets no entry in the map.
    //
    // Downstream effects (no code changes needed elsewhere):
    //   • Step 5 already has `if (!factPersonId) continue` — facts about
    //     unknown secondary people are skipped automatically.
    //   • Step 6 already has `if (!aId || !bId) continue` — edges involving
    //     unknown people are skipped automatically.
    //   • Connection facts *about* the primary person (e.g. "Introduced me to
    //     Marcus Webb") are written normally — person_name is the primary
    //     person, so their ID resolves fine.
    const personIdMap = await step.run('resolve-people', async () => {
      // Primary person is always in the map — their row exists from the form.
      const map: Record<string, string> = {
        [primaryPerson.name.toLowerCase()]: primaryPerson.id,
      };

      // Fetch all other existing vault members for this user and add them.
      // Case-insensitive match via lowercased key — handles minor Claude
      // capitalisation differences (e.g. "marcus webb" vs "Marcus Webb").
      const existing = await prisma.people.findMany({
        where: { user_id },
        select: { id: true, name: true },
      });
      for (const p of existing) {
        map[p.name.toLowerCase()] = p.id;
      }

      // Names absent from the map at this point are simply not in the vault.
      // No rows are created for them — they are ignored.
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

        const participants = extraction.conversation!.participants ?? [];
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

    log('written', { source_id, factsWritten, edgesWritten });

    // Hand off to the embed job. Embedding is the *true end* of processing, so
    // the embed job owns the terminal `processing_status = 'complete'` write
    // and the `processing_completed` analytics event. We forward person_id and
    // the counts so embed can emit a complete event without re-deriving them.
    await step.sendEvent('send-embed-event', {
      name: 'vault/facts.extracted',
      data: {
        person_id,
        source_id,
        user_id,
        facts_count: factsWritten,
        edges_count: edgesWritten,
      },
    });

    // Invalidate the vault context cache so the next query reflects the
    // newly extracted facts. This is a synchronous Map.delete — no step needed.
    invalidateContext(user_id);

    return { person_id, source_id, factsWritten, edgesWritten };
  }
);
