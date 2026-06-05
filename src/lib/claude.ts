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

// Calls Claude to extract structured facts from raw text.
// System prompt is defined in src/lib/prompts/extraction.ts (Step 29).
// Claude acts as extractor here — returns JSON, never streams.
export async function extractFromSource(
  rawText: string,
  sourceKind: SourceKind,
  systemPrompt: string
): Promise<ExtractionResult> {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Source kind: ${sourceKind}\n\nText:\n${rawText}`,
      },
    ],
  });

  const raw = message.content[0].type === 'text' ? message.content[0].text : '';

  // Strip markdown code fences if Claude wraps the JSON
  const cleaned = raw
    .replace(/^```(?:json)?\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();

  return JSON.parse(cleaned) as ExtractionResult;
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
  return embedding;
}
