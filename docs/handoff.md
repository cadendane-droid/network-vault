# Network Vault — Session Handoff

**Date:** 2026-06-05  
**Starting point:** Phase 3 complete through Step 31 (extraction pipeline + validation layer done)  
**Ending point:** Phase 4 complete — Steps 32–35 done, all intake pipeline bugs fixed, end-to-end test passed  
**Next step to pick up:** Step 36 — Query interface (Phase 5)

---

## 1. Steps Completed This Session

| Step | Summary |
|------|---------|
| **32** | Inngest embed job at `src/inngest/functions/embed.ts` — fetches unembedded facts via `$queryRaw`, embeds each with Voyage AI `voyage-3`, writes vectors with `$executeRaw`, computes `shared_interest` edges, safety-updates `processing_status`. Initially written as a single batch step; later fixed to per-fact steps (see Deviation H). |
| **33** | Registered `embedPersonFacts` in `src/app/api/inngest/route.ts` alongside `extractPersonFacts`. Fixed Clerk middleware blocking `/api/inngest` (see Deviation I). Both functions now appear in Inngest dashboard under Functions. |
| **34** | `GET /api/people/[id]/status` endpoint + `ProcessingIndicator` client component. Component polls every 3 s, calls `router.refresh()` on terminal status so the server component re-fetches facts without a full navigation. Profile page updated to use the component instead of a static banner. |
| **35** | End-to-end intake test — manual test passed after fixing per-fact step structure (Deviation H). All 7 facts received embeddings, correct fact rows in Postgres, correct edge rows, `processing_status` reached `'complete'`, profile page showed extracted facts after polling refresh. |

---

## 2. Current File State

### Created this session

| File | Purpose |
|------|---------|
| `src/inngest/functions/embed.ts` | `embedPersonFacts` Inngest function — triggered by `vault/facts.extracted`. 4 steps: `fetch-facts` ($queryRaw for null embeddings), `embed-fact-<id>` per fact (one step.run each), `compute-shared-interests`, `mark-complete`. |
| `src/app/api/people/[id]/status/route.ts` | `GET` — returns `{ status: string }` from the most recent source for the authenticated user. Auth-gated, person ownership verified. |
| `src/components/processing-indicator.tsx` | `'use client'` component — polls `/api/people/[id]/status` every 3 s while status is `pending` or `processing`. Calls `router.refresh()` on `complete` or `failed`. Renders pulsing indicator or error message. |
| `prisma/migrations/20260605000000_voyage_embeddings/migration.sql` | Drops `embedding vector(1536)`, re-adds as `vector(1024)`, creates `idx_facts_embedding` ivfflat cosine index (was missing from the indexes migration). |

### Modified this session

| File | Change |
|------|--------|
| `src/app/api/inngest/route.ts` | Added `embedPersonFacts` import and registration alongside `extractPersonFacts` |
| `src/app/(app)/people/[id]/page.tsx` | Replaced static `isProcessing` banner with `<ProcessingIndicator personId={id} initialStatus={processingStatus} />` |
| `src/lib/claude.ts` | Replaced `@ai-sdk/openai` + Vercel AI SDK `embed()` with `VoyageAIClient` from `voyageai`; `embedText()` now calls `voyage-3` (1024 dims) and requires `VOYAGE_API_KEY` |
| `prisma/schema.prisma` | `Unsupported("vector(1536)")` → `Unsupported("vector(1024)")` |
| `src/proxy.ts` | Added `/api/inngest` to `isPublicRoute` — Inngest sync and event delivery must bypass Clerk auth |

### Carried forward from previous session (unchanged)

| File | Purpose |
|------|---------|
| `src/app/(app)/layout.tsx` | Authenticated app shell — verifies auth, upserts user row, renders bottom nav |
| `src/app/(app)/people/page.tsx` | People list — server component, queries Prisma, renders PersonCard list |
| `src/app/(app)/people/new/page.tsx` | Add person page — thin wrapper around AddPersonForm |
| `src/app/(app)/people/[id]/page.tsx` | Person profile page — facts by type, conversations, connections, raw text collapsible, ProcessingIndicator |
| `src/app/(app)/query/page.tsx` | Placeholder — heading only, built out in Step 40 |
| `src/app/(app)/network/page.tsx` | Placeholder — heading only, built out in Step 46 |
| `src/app/(app)/account/page.tsx` | Placeholder — heading only, built out in Step 48 |
| `src/app/api/people/route.ts` | `POST` (create person + source, fire `vault/person.created`) and `GET` (list people with fact counts) |
| `src/app/api/people/[id]/route.ts` | `GET` — full person profile shape: facts, conversations, connections |
| `src/components/nav.tsx` | Client component — fixed bottom nav, 4 tabs, active state via `usePathname()` |
| `src/components/add-person-form.tsx` | Client component — controlled form, submits to API, navigates on success |
| `src/components/person-card.tsx` | Tappable card linking to `/people/[id]`, shows confirmed fact count or "Processing…" |
| `src/lib/claude.ts` | Anthropic singleton (`extractFromSource`), Voyage AI singleton (`embedText`) |
| `src/lib/auth.ts` | `getAuthenticatedUser()` — reads Clerk session, fetches DB user, returns `{ clerkId, userId, plan }` |
| `src/lib/prompts/extraction.ts` | `EXTRACTION_SYSTEM_PROMPT` — DM §6.1 output shape, all 7 §6.2 rules, enum contracts, 3 few-shot examples |
| `src/lib/validation/extraction.ts` | `validateExtractionOutput()` — all 7 DM §6.3 rules, returns `{ validFacts, validEdges, invalid }` |
| `src/inngest/client.ts` | Inngest client singleton — `id: 'network-vault'`, reads `INNGEST_EVENT_KEY` |
| `src/inngest/functions/extract.ts` | `extractPersonFacts` — 8 Inngest steps: fetch → Claude → validate → resolve people → write facts → write edges (dedup) → write conversation → mark-complete → fire `vault/facts.extracted` |

---

## 3. Deviations from the Implementation Plan

Deviations A–F from the previous handoff carry forward unchanged. New deviations from this session:

### A–F (carried forward)
- **A.** Prisma accessors are singular camelCase: `prisma.user`, `prisma.people`, `prisma.source`, `prisma.fact`, `prisma.conversation`, `prisma.conversationParticipant`, `prisma.edge`
- **B.** Inngest 4.5 uses 2-argument `createFunction(options, handler)` — trigger lives inside options as `triggers: [{ event: '...' }]`
- **C.** Step 31 (validation layer) was built as a dependency of Step 30 — already done, skip it
- **D.** Steps 26 and 27 were built out of order (unblocked the form navigation)
- **E.** ~~`@ai-sdk/openai` added~~ — superseded by Deviation G below
- **F.** DM §7.3 `ORDER BY status DESC` corrected to `ASC` (alphabetically `'confirmed' < 'raw'`, so ASC puts confirmed first)

### G. OpenAI replaced with Voyage AI for embeddings — schema dimension changed

The implementation plan assumed OpenAI embeddings (1536 dims). Anthropic has no embeddings endpoint; Voyage AI is their recommended solution. Changes:

- `@ai-sdk/openai` **removed** from `package.json`
- `voyageai@^0.3.1` **added** — official Voyage AI SDK
- `embedText()` in `src/lib/claude.ts` now uses `VoyageAIClient` with model `voyage-3` (1024 dims)
- `prisma/schema.prisma`: `Unsupported("vector(1536)")` → `Unsupported("vector(1024)")`
- Migration `20260605000000_voyage_embeddings` drops and recreates the `embedding` column at 1024 dims and adds the ivfflat index (which was missing from the Step 10 indexes migration)
- **New env var required:** `VOYAGE_API_KEY` — set in `.env.local` and Vercel. `OPENAI_API_KEY` is no longer referenced anywhere.
- Voyage AI produces fixed 1024-dim vectors from `voyage-3`. The pgvector cosine similarity query in DM §7.1 and `src/lib/retrieval.ts` (Step 38) must use `vector(1024)`.

### H. Embed job uses per-fact `step.run` instead of a single batch step

The initial implementation wrapped all `embedText()` calls in one `step.run('embed-and-write', ...)`. In production this caused partial embedding: if the 4th of 7 API calls failed (rate limit or transient error), the step threw after 3 successes. Inngest retried the whole step but with the memoized original fact list, so the same 3 got re-embedded and 4 stayed null indefinitely.

**Fix:** Each fact is now its own step — `step.run(`embed-fact-${fact.id}`, ...)`. Each step is independently memoized and retried. A failure at fact N retries only that step; facts 1 through N-1 are already memoized and skipped. This is the correct Inngest pattern for variable-length batches.

### I. `/api/inngest` must be excluded from Clerk auth middleware

Clerk's middleware matcher includes `/(api|trpc)(.*)`, which catches `/api/inngest`. Inngest's sync (`GET`) and event delivery (`POST`) requests arrive without a Clerk session and were returning 401. Functions showed as "not found" in the Inngest dashboard after deploy.

**Fix:** `/api/inngest` added to `isPublicRoute` in `src/proxy.ts`. Security is maintained by Inngest's own `INNGEST_SIGNING_KEY` verification inside the `serve()` handler.

---

## 4. Known Issues and Watch-Outs

### Source → person linking is user-scoped, not person-scoped

Both `src/app/(app)/people/[id]/page.tsx` (`latestSource`) and `src/app/api/people/[id]/status/route.ts` query the most recent source by `user_id`, not by `person_id`. The `Source` table has no `person_id` FK. For V1 (one person added at a time) this works correctly. For a user with many people it could show the wrong raw text or the wrong processing status on a profile.

This is an acceptable V1 limitation. The real fix requires either adding `person_id` to `Source` (schema change + migration) or routing through the `facts` join. Neither has been done.

### Validation Rule 5 enforcement is one-directional

In `src/lib/validation/extraction.ts` (lines ~128–141), orphaned connection facts (connection facts with no matching edge) are correctly detected and pushed to `invalid`, but are **not removed from `validFacts`**. They still get written to the DB. In practice Claude follows the prompt and always pairs connection facts with edges, so this doesn't fire in normal operation. A background task has been flagged to fix the filter.

### `Conversation.user_id` has no DB-level FK constraint

The `conversations` table has a `user_id` column (denormalized for query convenience) but the init migration did not add an `ALTER TABLE conversations ADD CONSTRAINT ... FOREIGN KEY (user_id) REFERENCES users(id)`. The Prisma schema also has no `user User @relation(...)` on the `Conversation` model. Data integrity is maintained by the application layer (the extract job always passes a valid `user_id`), not the DB constraint. Acceptable for V1.

### `processing_status` reaches `complete` before embeddings are written

The extract job marks the source as `complete` in step 8, then fires `vault/facts.extracted`. The embed job runs asynchronously after. This means the profile page can show "complete" (and reveal the facts) while `facts.embedding` is still null. Embeddings finish a few seconds later. For the query flow (Phase 5), retrieval only works correctly after embeddings are populated. The query UI should show an appropriate empty/loading state when a person was just added.

---

## 5. Environment Variables — Full Current State

| Variable | Used by | Status |
|----------|---------|--------|
| `DATABASE_URL` | Prisma (pooled, port 6543) | Set before Phase 1 |
| `DIRECT_URL` | Prisma migrations (direct, port 5432) | Set before Phase 1 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk client | Set before Phase 2 |
| `CLERK_SECRET_KEY` | Clerk server | Set before Phase 2 |
| `ANTHROPIC_API_KEY` | `src/lib/claude.ts` → `extractFromSource()` | Set before Phase 4 |
| `INNGEST_SIGNING_KEY` | Inngest `serve()` handler — verifies inbound requests | Set before Phase 4 |
| `INNGEST_EVENT_KEY` | Inngest client — authenticates outbound `inngest.send()` | Set before Phase 4 |
| `VOYAGE_API_KEY` | `src/lib/claude.ts` → `embedText()` | **Added this session** |

---

## 6. Prisma Model Accessor Reference

Verified against the generated client at `src/generated/prisma/`:

| Schema model | Prisma accessor | DB table |
|---|---|---|
| `User` | `prisma.user` | `users` |
| `People` | `prisma.people` | `people` |
| `Source` | `prisma.source` | `sources` |
| `Fact` | `prisma.fact` | `facts` |
| `Conversation` | `prisma.conversation` | `conversations` |
| `ConversationParticipant` | `prisma.conversationParticipant` | `conversation_participants` |
| `Edge` | `prisma.edge` | `edges` |

The `Fact.person` relation field is named `person` (singular), not `people`. Use `person: { user_id }` for relation filters on the `fact` model.

---

## 7. Next Step: Phase 5 — Query Interface (Steps 36–41)

Phase 4 is complete. The full intake pipeline is verified end-to-end. Phase 5 builds the natural language query surface on top of the embeddings that Phase 4 produces.

### Step 36 — Verify AI SDK and install Anthropic provider

The `ai` package (`@vercel/ai-sdk`, v6.0.197) is **already installed**. `@anthropic-ai/sdk` is also installed. What's missing is `@ai-sdk/anthropic` — the Vercel AI SDK provider wrapper for Anthropic that enables `streamText()`.

```bash
npm install @ai-sdk/anthropic
```

Then confirm `streamText` works with the Anthropic provider.

### Step 37 — Query system prompt

**File to create:** `src/lib/prompts/query.ts`

The prompt must:
- Instruct Claude to answer **only from the provided context facts** — never invent, never speculate
- **Attribute every claim to a named person** ("Sarah Chen works at…", not "Someone works at…")
- Say `"I don't have information about that in your vault"` when the context doesn't support an answer
- Format responses for mobile reading: short paragraphs, no bullet walls
- Receive context facts injected as a structured block (person name + fact type + value)

### Step 38 — Retrieval function

**File to create:** `src/lib/retrieval.ts`

Implements DM §7.1 semantic search:
```typescript
export async function retrieveContext(query: string, userId: string): Promise<ContextFact[]>
```

1. Call `embedText(query)` to get a 1024-dim query vector
2. Run the pgvector similarity query via `$queryRaw`:
```sql
SELECT f.value, f.type, f.status, p.name AS person_name
FROM facts f
JOIN people p ON f.person_id = p.id
WHERE p.user_id = $userId
  AND f.status IN ('raw', 'confirmed')
  AND f.embedding <=> $queryEmbedding < 0.4
ORDER BY f.embedding <=> $queryEmbedding ASC
LIMIT 20
```
3. Return facts with person names for context injection

**Note:** The query embedding is `vector(1024)`. Cast correctly: `${vectorString}::vector`. The `<=>` operator is pgvector cosine distance (not similarity — lower is closer).

### Step 39 — `POST /api/query` route

**File to create:** `src/app/api/query/route.ts`

- Call `getAuthenticatedUser()`
- Call `retrieveContext(question, userId)`
- If no facts returned → return empty context message directly (don't call Claude for empty vaults)
- Inject facts into prompt as: `[Person Name — fact_type]: value`
- Call `streamText` from Vercel AI SDK with `@ai-sdk/anthropic` provider, `claude-sonnet-4-5` model
- Return streaming response
- **Plan gate:** check `user.plan` — if `'free'` and query count exceeds free tier limit, return 402. (Query count tracking is not implemented yet; implement the gate but wire it to a TODO for now.)

### Step 40 — Query UI

**File to update:** `src/app/(app)/query/page.tsx` (currently a placeholder)
**File to create:** `src/components/chat.tsx`

- Use `useChat` hook from `ai/react` pointed at `POST /api/query`
- Mobile-first layout: message thread scrolls above, input fixed at bottom
- Each assistant message streams in with the Vercel AI SDK streaming protocol
- Empty state: 3 example questions (hardcoded, relevant to the relationship intelligence use case)
- Empty vault state (no people added yet): show a prompt to add people first, link to `/people/new`

### Step 41 — Empty vault state in query

Handle the case where `retrieveContext` returns 0 facts. The query page should detect this and show a clear message rather than an empty chat or a confusing AI response.

---

## 8. Key Architectural Notes for Phase 5

**The pgvector query uses `<=>` (cosine distance), not `<->` (L2 distance).** The ivfflat index was created with `vector_cosine_ops`. Using L2 distance against a cosine index will do a full table scan and return wrong results. Always use `<=>`.

**The 0.4 distance threshold** in the retrieval query is a starting point. Values closer to 0 = more similar. 0.4 is intentionally loose for V1 to ensure enough facts are returned. Tighten if query answers are noisy.

**Context injection format matters.** The query prompt works best when facts are formatted with clear attribution before each one: `[Sarah Chen — role]: Partner` rather than a flat list. This makes it easy for Claude to cite the source person.

**`streamText` requires `@ai-sdk/anthropic`, not `@anthropic-ai/sdk` directly.** The Vercel AI SDK's streaming helpers require their own provider wrappers. The two packages coexist fine — `@anthropic-ai/sdk` is used directly for the extraction job (non-streaming JSON), `@ai-sdk/anthropic` is used for the query route (streaming text).
