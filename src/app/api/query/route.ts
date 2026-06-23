import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import prisma from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { captureServerEvent } from '@/lib/posthog-server';
import { buildVaultContext } from '@/lib/vault-context';
import { getCachedContext, setCachedContext } from '@/lib/vault-cache';
import { QUERY_SYSTEM_PROMPT } from '@/lib/prompts/query';
import { DAILY_QUERY_LIMIT, MONTHLY_QUERY_LIMIT } from '@/lib/limits';
import { currentDailyCount, currentMonthlyCount, utcToday } from '@/lib/usage';

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

  const { question, conversation_id, turn_index } = body as Record<
    string,
    unknown
  >;
  if (!question || typeof question !== 'string' || question.trim() === '') {
    return NextResponse.json(
      { error: 'question is required' },
      { status: 400 }
    );
  }

  // Query caps — daily first, then monthly; whichever trips first wins.
  // Counters with a rolled-over window read as 0 (see src/lib/usage.ts).
  const now = new Date();
  const queriesToday = currentDailyCount(
    user.daily_query_count,
    user.daily_query_reset_at,
    now
  );
  if (queriesToday >= DAILY_QUERY_LIMIT) {
    return NextResponse.json(
      {
        error: 'DAILY_QUERY_LIMIT',
        message: 'Daily query limit reached. Come back tomorrow.',
      },
      { status: 402 }
    );
  }
  const queriesThisMonth = currentMonthlyCount(
    user.monthly_query_count,
    user.monthly_query_reset_at,
    now
  );
  if (queriesThisMonth >= MONTHLY_QUERY_LIMIT) {
    return NextResponse.json(
      {
        error: 'MONTHLY_QUERY_LIMIT',
        message: 'Monthly query limit reached.',
      },
      { status: 402 }
    );
  }

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

  // The route loads the full vault as context rather than retrieving a
  // per-query subset, so results_count is the number of facts the context
  // includes — same filters as buildVaultContext.
  const resultsCount = await prisma.fact.count({
    where: {
      status: { in: ['raw', 'confirmed'] },
      person: { user_id: user.userId, status: 'active' },
    },
  });
  // #14 — thread context from the client (ids/index only, no query text). A
  // "repeat query" is any query_asked with turn_index >= 2; no separate event.
  await captureServerEvent(user.clerkId, 'query_asked', {
    results_count: resultsCount,
    ...(typeof conversation_id === 'string' ? { conversation_id } : {}),
    ...(typeof turn_index === 'number' ? { turn_index } : {}),
  });

  // All gates passed and the vault is non-empty — the query is being served,
  // so count it. Writing counts and window dates together makes resets
  // implicit. Done before streaming starts; afterwards the response is
  // committed and a failed update couldn't be surfaced anyway.
  await prisma.user.update({
    where: { id: user.userId },
    data: {
      daily_query_count: queriesToday + 1,
      daily_query_reset_at: utcToday(now),
      monthly_query_count: queriesThisMonth + 1,
      monthly_query_reset_at: utcToday(now),
    },
  });

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
