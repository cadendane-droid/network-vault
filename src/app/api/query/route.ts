import { NextRequest, NextResponse } from 'next/server';
import { streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { getAuthenticatedUser } from '@/lib/auth';
import { retrieveContext } from '@/lib/retrieval';
import { QUERY_SYSTEM_PROMPT } from '@/lib/prompts/query';

export async function POST(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { question } = body as Record<string, unknown>;
  if (!question || typeof question !== 'string' || question.trim() === '') {
    return NextResponse.json(
      { error: 'question is required' },
      { status: 400 }
    );
  }

  // TODO: enforce free-tier query count limit once usage tracking is implemented.
  // if (user.plan === 'free' && queryCount >= FREE_TIER_QUERY_LIMIT) {
  //   return NextResponse.json({ error: 'Query limit reached. Upgrade to Pro.' }, { status: 402 });
  // }

  // Retrieval errors (DB connection, pgvector, embedding API) must be caught
  // here — after this point the 200 header is committed and errors are silent.
  let facts: Awaited<ReturnType<typeof retrieveContext>>;
  try {
    facts = await retrieveContext(question.trim(), user.userId);
  } catch (err) {
    console.error('[query] retrieveContext failed:', err);
    return NextResponse.json(
      {
        error: 'Failed to retrieve context from your vault. Please try again.',
      },
      { status: 500 }
    );
  }

  const contextBlock =
    facts.length > 0
      ? facts
          .map((f) => `[${f.person_name} — ${f.type}]: ${f.value}`)
          .join('\n')
      : '(no relevant facts found in vault)';

  const userMessage = `Context:\n${contextBlock}\n\nQuestion: ${question.trim()}`;

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: QUERY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    maxOutputTokens: 1024,
    // Log any model/API error that occurs after the stream has started.
    // Without this, streamText swallows the error and closes the stream
    // silently — the client sees an empty assistant bubble with no clue why.
    onError: (event) => {
      console.error('[query] streamText error:', event.error);
    },
  });

  // toTextStreamResponse emits UTF-8 text deltas — simpler to consume
  // than the UI message stream protocol when doing stateless RAG queries.
  return result.toTextStreamResponse();
}
