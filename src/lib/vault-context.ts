import prisma from '@/lib/prisma';

// Returns the cache key for a user's vault context string.
export function getVaultContextCacheKey(userId: string): string {
  return `vault-context-${userId}`;
}

// Capitalise the first word of a snake_case type name and replace underscores
// with spaces. e.g. "life_situation" → "Life situation", "role" → "Role".
function formatTypeLabel(type: string): string {
  const words = type.split('_');
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(' ');
}

// Serialise the user's entire vault to a structured plain-text string
// suitable for use as a Claude system prompt context block.
//
// Returns an empty string if the user has no active people — the query
// route treats this as an empty-vault signal and responds without calling
// Claude.
export async function buildVaultContext(userId: string): Promise<string> {
  // 1. Fetch all active people ordered by name for a consistent serialisation
  // (stable order = identical string for the same data = better cache hits).
  const people = await prisma.people.findMany({
    where: { user_id: userId, status: 'active' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  if (people.length === 0) return '';

  // 2. Fetch each person's facts, conversations, and edges in parallel.
  // All people are fetched simultaneously — the cost is paid once per cache
  // miss (at most once per hour) and amortised across all queries.
  const personBlocks = await Promise.all(
    people.map(async (person) => {
      const [facts, conversations, edges] = await Promise.all([
        // Facts: confirmed before raw (status ASC), most recent first within type.
        prisma.fact.findMany({
          where: {
            person_id: person.id,
            status: { in: ['raw', 'confirmed'] },
          },
          select: { type: true, value: true },
          orderBy: [{ type: 'asc' }, { created_at: 'desc' }],
        }),

        // Conversations: 10 most recent, summary only.
        prisma.conversation.findMany({
          where: { participants: { some: { person_id: person.id } } },
          select: { date: true, summary: true },
          orderBy: { date: 'desc' },
          take: 10,
        }),

        // Edges: both directions — resolve the other person's name via the
        // personA / personB Prisma relation fields.
        prisma.edge.findMany({
          where: {
            OR: [{ person_a: person.id }, { person_b: person.id }],
          },
          select: {
            person_a: true,
            person_b: true,
            relationship_type: true,
            personA: { select: { name: true } },
            personB: { select: { name: true } },
          },
        }),
      ]);

      const lines: string[] = [`PERSON: ${person.name}`];

      // Facts — group consecutive rows of the same type under one label line.
      // The DB order (type ASC) already groups them; we just iterate.
      let lastType = '';
      for (const fact of facts) {
        const label = formatTypeLabel(fact.type);
        if (fact.type !== lastType) {
          lastType = fact.type;
          // All facts use inline "Label: value" format (not a section header).
        }
        lines.push(`${label}: ${fact.value}`);
      }

      // Connections — omit section entirely if none.
      const connectionLines = edges.map((e) => {
        const otherName =
          e.person_a === person.id ? e.personB.name : e.personA.name;
        return `  - ${otherName} [${e.relationship_type}]`;
      });
      if (connectionLines.length > 0) {
        lines.push('Connections:');
        lines.push(...connectionLines);
      }

      // Recent conversations — omit section entirely if none or no summaries.
      const conversationLines = conversations
        .filter((c) => c.summary)
        .map((c) => {
          const date = new Date(c.date).toISOString().split('T')[0];
          return `  - ${date}: ${c.summary}`;
        });
      if (conversationLines.length > 0) {
        lines.push('Recent conversations:');
        lines.push(...conversationLines);
      }

      return lines.join('\n');
    })
  );

  const header = [
    'NETWORK VAULT — FULL CONTEXT',
    `Total people: ${people.length}`,
    `Last updated: ${new Date().toISOString()}`,
  ].join('\n');

  const body = personBlocks.join('\n---\n');

  return `${header}\n\n${body}\n\nEND OF VAULT CONTEXT`;
}
