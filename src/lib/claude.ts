import Anthropic from '@anthropic-ai/sdk';
import { VoyageAIClient } from 'voyageai';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const voyage = new VoyageAIClient({
  apiKey: process.env.VOYAGE_API_KEY,
});

export type SourceKind = 'conversation' | 'note' | 'profile' | 'observation';

export interface ExtractionResult {
  conversation: {
    summary: string | null;
    participants: string[];
  } | null;
  facts: Array<{
    person_name: string;
    type: string;
    value: string;
  }>;
  edges: Array<{
    person_a: string;
    person_b: string;
    relationship_type: string;
  }>;
}

// Dimension of the vector produced by voyage-3. MUST match the
// facts.embedding column type (vector(1024)) in prisma/schema.prisma and the
// migration that created it. A mismatch makes every embedding INSERT fail.
export const EMBEDDING_DIMENSIONS = 1024;

// Pulls the JSON object out of a Claude completion. Tolerates markdown code
// fences and any stray preamble/postamble by slicing to the outermost braces.
// Throws a descriptive error (never returns malformed data) so the caller can
// mark the source 'failed' with a diagnosable message instead of a raw
// SyntaxError.
function parseExtractionJson(raw: string): ExtractionResult {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `extractFromSource: no JSON object found in Claude response (got ${raw.length} chars): ${raw.slice(0, 200)}`
    );
  }
  const slice = raw.slice(start, end + 1);
  try {
    return JSON.parse(slice) as ExtractionResult;
  } catch (err) {
    throw new Error(
      `extractFromSource: failed to parse JSON (${(err as Error).message}): ${slice.slice(0, 200)}`
    );
  }
}

// Calls Claude to extract structured facts from raw text.
// System prompt is defined in src/lib/prompts/extraction.ts (Step 29).
// Claude acts as extractor here — returns JSON, never streams.
export async function extractFromSource(
  rawText: string,
  sourceKind: SourceKind,
  systemPrompt: string,
  // When provided, prepended as "Primary subject: <name>" so Claude knows
  // who pronouns (He, She, They…) in the text refer to. Injected into the
  // user message rather than the system prompt to preserve prompt caching.
  primaryPersonName?: string
): Promise<ExtractionResult> {
  const primarySubjectLine = primaryPersonName
    ? `Primary subject: ${primaryPersonName}\n\n`
    : '';

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    // Rich notes can produce large extractions. 4096 was low enough to
    // truncate the JSON mid-object on long sources, yielding an unparseable
    // response. 8192 gives ample headroom for the structured output.
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `${primarySubjectLine}Source kind: ${sourceKind}\n\nText:\n${rawText}`,
      },
    ],
  });

  // A truncated completion is not recoverable — fail loudly with the token
  // count so the cause is obvious in the logs rather than a cryptic JSON error.
  if (message.stop_reason === 'max_tokens') {
    throw new Error(
      `extractFromSource: Claude response truncated at max_tokens (${message.usage?.output_tokens ?? '?'} output tokens) — JSON is incomplete`
    );
  }

  // Concatenate every text block (the model may split output across blocks),
  // not just content[0].
  const raw = message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();

  return parseExtractionJson(raw);
}

// Generates a 1024-dim vector for semantic search via pgvector.
// Uses Voyage AI voyage-3 model. Requires VOYAGE_API_KEY in environment.
export async function embedText(text: string): Promise<number[]> {
  const result = await voyage.embed({
    input: text,
    model: 'voyage-3',
  });
  const embedding = result.data?.[0]?.embedding;
  if (!embedding) throw new Error('Voyage AI returned no embedding');
  // Guard against a model/column dimension mismatch. A vector of the wrong
  // length would be rejected by the vector(1024) column with an opaque
  // Postgres error; this surfaces it at the source with a clear message.
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `embedText: expected a ${EMBEDDING_DIMENSIONS}-dim vector from voyage-3, got ${embedding.length}`
    );
  }
  return embedding;
}
