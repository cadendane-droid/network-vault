import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAuthenticatedUser } from '@/lib/auth';
import { buildVaultContext } from '@/lib/vault-context';
import { getCachedContext, setCachedContext } from '@/lib/vault-cache';
import { QUERY_SYSTEM_PROMPT } from '@/lib/prompts/query';

// Module-level singleton — same pattern as src/lib/claude.ts.
// Build-safe: Anthropic SDK reads the env var at call time, not import time.
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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

  // Build (or retrieve from cache) the full vault context string.
  // Context serialisation and any DB errors must be caught here — once the
  // streaming Response is returned the 200 header is committed and we can
  // no longer send an error status.
  let vaultContext: string;
  try {
    const cached = getCachedContext(user.userId);
    if (cached !== null) {
      vaultContext = cached;
    } else {
      vaultContext = await buildVaultContext(user.userId);
      if (vaultContext) setCachedContext(user.userId, vaultContext);
    }
  } catch (err) {
    console.error('[query] buildVaultContext failed:', err);
    return NextResponse.json(
      { error: 'Failed to load your vault. Please try again.' },
      { status: 500 }
    );
  }

  // Empty vault — user has no active people yet.
  if (!vaultContext) {
    return NextResponse.json(
      {
        error: 'Your vault is empty. Add some people first to start querying.',
      },
      { status: 400 }
    );
  }

  // Call Claude with prompt caching.
  //
  // System is an array of two blocks:
  //   [0] vault context  — marked cache_control: ephemeral so Anthropic caches
  //       this large block across requests. Cache hits save ~95% of input tokens.
  //   [1] query instructions — smaller, not cached (changes rarely but cheaply).
  //
  // The response is streamed as raw UTF-8 text deltas piped through a
  // ReadableStream. The client (chat.tsx) reads chunks via TextDecoder —
  // no framing or envelope format, identical to the previous toTextStreamResponse().
  const stream = anthropicClient.messages.stream({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: [
      {
        type: 'text' as const,
        text: vaultContext,
        cache_control: { type: 'ephemeral' as const },
      },
      {
        type: 'text' as const,
        text: QUERY_SYSTEM_PROMPT,
      },
    ],
    messages: [{ role: 'user', content: question.trim() }],
  });

  const encoder = new TextEncoder();
  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        // Error after streaming has started — can't change status code.
        // Log it; the client's empty-stream guard shows a fallback message.
        console.error('[query] anthropic stream error:', err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readableStream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
