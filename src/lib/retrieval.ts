import Anthropic from '@anthropic-ai/sdk';
import prisma from '@/lib/prisma';
import { embedText } from '@/lib/claude';

export interface ContextFact {
  value: string;
  type: string;
  status: string;
  person_name: string;
}

interface ContextFactWithId extends ContextFact {
  id: string;
}

let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic)
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// Rewrites a natural language query into keyword form that matches how facts
// are stored (short, atomic claims). Improves embedding similarity scores
// especially for person-name queries and broad topic queries.
async function rewriteQuery(query: string): Promise<string> {
  try {
    const response = await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      system: `Rewrite the user's question as space-separated keywords matching facts stored in a personal relationship vault. Focus on: names, job titles, organizations, locations, interests, industry terms. Return only the keywords — no punctuation, no explanation.

Examples:
"Tell me about Jordan Park" → Jordan Park role org location interests background context
"Who do I know in fintech?" → fintech finance payments banking embedded finance
"What did Marcus say about the fundraise?" → Marcus fundraise investment capital raising quote`,
      messages: [{ role: 'user', content: query }],
    });
    const text =
      response.content[0]?.type === 'text'
        ? response.content[0].text.trim()
        : null;
    return text || query;
  } catch {
    return query;
  }
}

export async function retrieveContext(
  query: string,
  userId: string
): Promise<ContextFact[]> {
  // Kick off query rewriting and people fetch in parallel — both are needed
  // before we can embed or match names, but neither depends on the other.
  const [rewrittenQuery, allPeople] = await Promise.all([
    rewriteQuery(query),
    prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
      `SELECT id::text, name FROM people WHERE user_id = $1::uuid AND status = 'active'`,
      userId
    ),
  ]);

  // Name-based pre-fetch: any person whose name appears in the query gets all
  // their facts included regardless of embedding distance.
  // Two match strategies:
  //   1. Full name — substring match on the whole lowercased name. Specific
  //      enough that substring false positives are rare ("jordan park" in query
  //      text is almost certainly the person).
  //   2. First name only — word match (not substring) so "marcus" in "what did
  //      Marcus say?" matches but "mark" in "markdown" does not. Gated at >= 4
  //      chars to skip common short words (e.g. "anna" is fine, "al" is not).
  const queryLower = query.toLowerCase();
  // Split on non-word characters so "Marcus?" → {"marcus"} and punctuation
  // doesn't prevent a match.
  const queryWords = new Set(queryLower.split(/\W+/).filter(Boolean));
  const matchedPersonIds = allPeople
    .filter((p) => {
      const nameLower = p.name.toLowerCase();
      if (queryLower.includes(nameLower)) return true;
      const firstName = nameLower.split(' ')[0];
      return firstName.length >= 4 && queryWords.has(firstName);
    })
    .map((p) => p.id);

  // Embed the rewritten query for vector search.
  const vector = await embedText(rewrittenQuery);
  const vectorStr = JSON.stringify(vector);

  // Run name-fact fetch and vector search in parallel.
  const nameFactsPromise =
    matchedPersonIds.length > 0
      ? prisma.$queryRawUnsafe<ContextFactWithId[]>(
          `SELECT f.id::text, f.value, f.type, f.status, p.name AS person_name
           FROM facts f
           JOIN people p ON f.person_id = p.id
           WHERE f.person_id IN (${matchedPersonIds.map((_, i) => `$${i + 1}::uuid`).join(', ')})
             AND f.status IN ('raw', 'confirmed')`,
          ...matchedPersonIds
        )
      : Promise.resolve<ContextFactWithId[]>([]);

  // $queryRawUnsafe is used instead of the $queryRaw tagged template because
  // Prisma v7's template literal processor conflicts with PostgreSQL's ::
  // cast operator when it immediately follows a $N placeholder.
  // $2 appears twice (WHERE and ORDER BY) — PostgreSQL supports parameter reuse.
  const vectorFactsPromise = prisma.$queryRawUnsafe<ContextFactWithId[]>(
    `SELECT f.id::text, f.value, f.type, f.status, p.name AS person_name
     FROM facts f
     JOIN people p ON f.person_id = p.id
     WHERE p.user_id = $1::uuid
       AND f.status IN ('raw', 'confirmed')
       AND f.embedding IS NOT NULL
       AND f.embedding <=> $2::vector < 0.5
     ORDER BY f.embedding <=> $2::vector ASC
     LIMIT 20`,
    userId,
    vectorStr
  );

  const [nameFacts, vectorFacts] = await Promise.all([
    nameFactsPromise,
    vectorFactsPromise,
  ]);

  // Merge: name-matched facts take priority (guaranteed inclusion even with no
  // embeddings or high distances). Vector facts fill remaining slots.
  // Deduplicate by fact id. Cap at 20 total.
  const seen = new Set<string>();
  const merged: ContextFact[] = [];

  for (const fact of [...nameFacts, ...vectorFacts]) {
    if (merged.length >= 20) break;
    if (seen.has(fact.id)) continue;
    seen.add(fact.id);
    const { id: _id, ...contextFact } = fact;
    merged.push(contextFact);
  }

  return merged;
}
