import prisma from '@/lib/prisma';
import { embedText } from '@/lib/claude';

export interface ContextFact {
  value: string;
  type: string;
  status: string;
  person_name: string;
}

export async function retrieveContext(
  query: string,
  userId: string
): Promise<ContextFact[]> {
  const vector = await embedText(query);
  const vectorStr = JSON.stringify(vector);

  // Cosine distance via pgvector <=> operator (lower = more similar).
  // ivfflat index was created with vector_cosine_ops — must use <=> here,
  // not <-> (L2), or the index is bypassed and results are wrong.
  // 0.5 threshold — widened from 0.4 after testing showed semantically related
  // queries landing just outside 0.4. Tighten if query answers become noisy.
  // embedding IS NOT NULL guard handles facts written before the embed job ran.
  const facts = await prisma.$queryRaw<ContextFact[]>`
    SELECT f.value, f.type, f.status, p.name AS person_name
    FROM facts f
    JOIN people p ON f.person_id = p.id
    WHERE p.user_id = ${userId}::uuid
      AND f.status IN ('raw', 'confirmed')
      AND f.embedding IS NOT NULL
      AND f.embedding <=> ${vectorStr}::vector < 0.5
    ORDER BY f.embedding <=> ${vectorStr}::vector ASC
    LIMIT 20
  `;

  return facts;
}
