# Network Vault — Session Handoff

**Date:** 2026-06-08  
**Starting point:** Phase 7 in progress — Steps 47–49 done (error boundaries, Stripe billing, free-tier limits). Steps 50–52 remaining.  
**Ending point:** Phase 7 still in progress — Steps 50–52 not yet formally completed. Substantial additional work outside the plan completed this session (see §1b below).  
**Next step to pick up:** Step 50 — Mobile testing and responsive polish

---

## 0. Intake / extraction pipeline reliability fix (2026-06-16)

Self-contained record of the production "infinite Processing… spinner" fix. Read
this section alone to act on it.

### Confirmed root cause (static analysis — no live DB/creds used)

The **extract job left sources stuck in `processing` forever on any failure in
its middle steps.** `processing_status` was only set to `'failed'` in two places
(the source/person null-check and the `call-claude` try/catch). Steps 3–8 —
`validate`, `resolve-people`, `write-facts`, `write-edges`, `write-conversation`,
`mark-complete` — had **no failure handling**. If any threw, Inngest exhausted
retries and the function died **without** moving the source out of `processing`.
Result: silent infinite spinner, `mark-complete` and the `processing_completed`
event never reached. This matches PostHog exactly (`person_added` /
`source_submitted` fire; `processing_completed` almost never does).

Two intermittent triggers for such a throw (explains "1 of 3 completed"):
- **Fragile validation** — `validateExtractionOutput` did `for (const f of result.facts)` / `result.edges` with **no array guard**; a Claude response with `facts: null` or a missing key threw `… is not iterable` inside the unguarded `validate` step.
- **Claude JSON truncation** — `extractFromSource` used `max_tokens: 4096`; a rich note (the lost beta user) overflowed it → truncated, unparseable JSON.

**The embedding-dimension hypothesis was NOT the cause.** Schema, generated
client, and migration `20260605000000_voyage_embeddings` already use
`vector(1024)`, matching `voyage-3`. The only `1536` reference was a stale
comment. **No migration was required — Phase 4 skipped.** (Even if the column
were wrong, embed failure could not have caused the spinner, because the
*extract* job owned the `complete` write that clears it.)

### What changed and why

| File | Change |
|------|--------|
| `src/inngest/functions/extract.ts` | **Added `onFailure` handler** → sets `processing_status='failed'` after retries exhaust (the actual root-cause fix; guarantees a terminal status on every path). Removed the redundant inline `failed` updates (onFailure covers them). Moved the terminal `complete` write + `processing_completed` event **out** of extract — extract now just hands off to embed via `vault/facts.extracted`, forwarding `person_id` + `facts_count`/`edges_count`. Added structured `[extract]` stage logging. |
| `src/inngest/functions/embed.ts` | **Added `onFailure` handler** (same terminal-status guarantee). Embed now **owns the `complete` write + `processing_completed`** — the *true* end of processing (extraction **and** embedding done). Logs each embedded fact's vector dimension. Fixed stale `vector(1536)` comment → `1024`. |
| `src/lib/claude.ts` | `extractFromSource`: `max_tokens` 4096→**8192**; explicit **`stop_reason==='max_tokens'` truncation error**; concatenates all text blocks; robust JSON extraction (`parseExtractionJson` slices to outermost braces, throws descriptive errors). `embedText`: exported `EMBEDDING_DIMENSIONS=1024` and a **dimension guard** that throws on mismatch. |
| `src/lib/validation/extraction.ts` | **Array guard**: `facts`/`edges` default to `[]` (flagged in `invalid`) instead of throwing when Claude returns a non-array. |
| `src/components/processing-indicator.tsx` | `failed` state now shows a **"Try again" button** that POSTs to the owner reprocess endpoint and resumes polling (poll effect re-keyed on `status` so retry restarts it). This is the change that would have saved the lost user. |
| `src/app/(app)/people/[id]/page.tsx` | Suppress the "No facts extracted yet" empty state when status is `failed` (avoids mixed messaging next to the retry button). |
| `src/lib/reprocess.ts` *(new)* | `reprocessSource({sourceId, personId, userId})` — deletes any partial writes for the source (conv-participants → conversations → edges → facts), resets to `processing`, re-sends `vault/person.created`. Idempotent; prevents duplicate facts on re-run. |
| `src/app/api/people/[id]/reprocess/route.ts` *(new)* | Owner-scoped retry (used by the UI button). Re-runs the owner's most recent source (same V1 heuristic as the status route). |
| `src/app/api/admin/reprocess/route.ts` *(new)* | Admin-only (`ADMIN_CLERK_IDS`) recovery for **any** user's stuck source. Body `{ source_id, person_id }`. Use this to recover the existing stuck beta user. |

### Behavior change to know

`complete` (and the spinner clearing) now happens **after embedding**, not after
extraction. So an **embed** failure now flips the source to `failed` even though
extract wrote facts (facts still render on the profile; only semantic search is
degraded until reprocess). This is intentional — "complete" now means
genuinely query-ready.

### Recover the existing stuck beta user

Option A — admin endpoint (signed in as an `ADMIN_CLERK_IDS` user):
```bash
curl -X POST https://<host>/api/admin/reprocess \
  -H 'Content-Type: application/json' \
  -b '<authenticated session cookie>' \
  -d '{"source_id":"<stuck-source-uuid>","person_id":"<person-uuid>"}'
```
Option B — manual event re-send: after deleting any partial facts/edges for that
`source_id`, send `vault/person.created` with `{person_id, source_id, user_id}`
from the Inngest dashboard.

### Verification checklist (run with env vars present — `vercel env pull` or a preview deploy)

1. Confirm the column is already `vector(1024)` (no migration needed):
   `psql "$DIRECT_URL" -c "\d facts"` → `embedding | vector(1024)`. If it shows `1536`, the `20260605` migration was never applied — run `npx prisma migrate deploy`.
2. Add a test person with a rich, long note. In the Inngest dashboard, both `extract-person-facts` and `embed-person-facts` runs succeed (no retries/errors). `[extract]`/`[embed]` log lines show stage progress.
3. `SELECT count(*) FROM facts WHERE source_id='…' AND embedding IS NOT NULL;` > 0, and a pgvector cosine query returns rows.
4. `processing_status` reaches `complete`; `processing_completed` fires in PostHog.
5. A natural-language query returns an attributed answer.
6. Force a failure (e.g. temporarily set a bad `VOYAGE_API_KEY`, or submit a deliberately adversarial note) → source reaches `failed`, the profile shows **"Processing failed… / Try again"** instead of spinning. Click "Try again" → it reprocesses.
7. Run the admin reprocess against the real stuck source → it completes.

---

## 1a. Steps Completed — Previous Session (2026-06-06)

| Step | Summary |
|------|---------|
| **42** | `GET /api/graph` at `src/app/api/graph/route.ts` — auth-gated, returns `{ nodes, edges }`. Nodes include `id`, `name`, `factCount`, `hasConfirmedFacts`, `role`, `org` (role and org added during Step 45 so the bottom sheet has context without an extra fetch). Edges renamed `person_a`/`person_b` → `source`/`target` for react-force-graph-2d. |
| **43** | Installed `react-force-graph-2d@1.29.1`. Created `src/components/constellation.tsx` — `'use client'`, dynamic import with `ssr: false`, fetches from `/api/graph`, `ResizeObserver` for dimensions, `useMemo` for stable graph data reference (prevents simulation restart on re-render), loading and error states, `linkLineDash` for dashed inferred edges. |
| **44** | Graph visual properties — `nodeVal` maps factCount to radius via library formula `sqrt(val) * nodeRelSize`. `nodeCanvasObject` in `'after'` mode draws name labels at zoom > 1.5 (font scales inversely with globalScale for constant apparent size). `linkLabel` shows relationship_type on edge hover. |
| **45** | Node click → bottom sheet. Updated `GET /api/graph` to include `role` and `org` on nodes. Bottom sheet uses `fixed inset-0 z-50 flex items-end mb-16`. Shows name, role, org (or fact count fallback). Backdrop tap or × dismisses, "View profile" Link navigates to `/people/[id]`. |
| **46** | `src/app/(app)/network/page.tsx` — server component, counts active people, shows empty state for < 2 people, renders `<Constellation />` in `h-[calc(100dvh-4rem)]` for ≥ 2 people. |
| **47** | Error boundaries and loading states. Created `src/app/(app)/error.tsx`. Created `people/loading.tsx`, `people/[id]/loading.tsx`, `network/loading.tsx` skeletons. Fixed silent `streamText` failure in `chat.tsx` — empty-stream guard sets error string if assistant content is empty after stream closes. |
| **48** | Stripe billing. Added `stripe_customer_id` to `User` schema (migration applied manually). Created `src/lib/stripe.ts` (lazy `getStripe()` singleton), `src/app/api/stripe/checkout/route.ts`, `src/app/api/webhooks/stripe/route.ts` (handles 3 subscription events), `src/components/upgrade-button.tsx`, full `src/app/(app)/account/page.tsx`. Added `/api/webhooks/stripe` to public routes in `proxy.ts`. |
| **49** | Free-tier limits. Added 25-person gate to `POST /api/people` (counts active + archived; Pro skips; returns 402). `add-person-form.tsx` detects 402 and shows amber upgrade banner. Account page shows people count + progress bar. Added `account/loading.tsx`. |

### Bugs fixed outside the plan (2026-06-06 session)

| Bug | Files changed | Fix |
|-----|--------------|-----|
| **Landing page was Next.js boilerplate** | `src/app/page.tsx` | Replaced with dark landing page — server-side auth check redirects authenticated users to `/people`; unauthenticated users see wordmark, "Get started" → `/sign-up`, "Sign in" → `/sign-in` |
| **Ghost people rows from pronoun extraction** | `src/lib/prompts/extraction.ts`, `src/lib/claude.ts`, `src/inngest/functions/extract.ts`, `src/lib/validation/extraction.ts` | Three-layer fix: (1) Rule 8 in system prompt; (2) `Primary subject: [Name]` injected into user message; (3) `STANDALONE_PRONOUNS` blocklist in validation |
| **Query returning "Something went wrong"** | `src/app/api/query/route.ts`, `src/lib/retrieval.ts` | Prisma v7 `$queryRaw` conflicts with `::vector` cast. Fixed by switching to `$queryRawUnsafe(sql, ...params)`. |
| **Stripe build failure** | `src/lib/stripe.ts` | `new Stripe(...)` at module scope crashed Vercel build. Changed to lazy `getStripe()`. |
| **Bottom sheet behind nav bar** | `src/components/constellation.tsx` | Added `mb-16` to sheet panel to clear the 4rem fixed bottom nav. |

---

## 1b. Work Completed — This Session (2026-06-08)

All items below are outside the formal 52-step plan unless noted.

| Item | Summary |
|------|---------|
| **Query retrieval: name matching** | `src/lib/retrieval.ts` — Added query rewriting via Claude Haiku (converts natural language to fact-space keywords before embedding). Added name-based pre-fetch: full-name substring match + first-name word match (≥ 4 chars) guarantees all facts for a named person are included regardless of cosine distance. Deduplication by fact ID. See Deviation S. |
| **Security audit** | Audited all 10 `src/app/api/` routes. Deleted `src/app/api/test/route.ts` (unauthenticated `SELECT 1` debug endpoint from Step 14). All remaining routes confirmed to call `getAuthenticatedUser()` first. See Deviation W. |
| **RLS migration** | Created and applied `prisma/migrations/20260606120000_rls/migration.sql` — enables `ROW LEVEL SECURITY` on all 7 tables. Fixes Check 3 of the security review. See Deviation V. |
| **Person resolution fix** | `src/inngest/functions/extract.ts` — Step 4 no longer auto-creates `people` rows for secondary names Claude mentions. Only the primary person (submitted via the Add Person form) gets a new row. Unrecognised secondary names are absent from `personIdMap` and silently skipped by existing `continue` guards in Steps 5–6. See Deviation U. |
| **Ghost people cleanup** | `scripts/cleanup-ghost-people.sql` — one-time SQL script to delete people rows with 0 facts, 0 edges, and 0 conversation_participants. Run with `npx prisma db execute --file scripts/cleanup-ghost-people.sql`. Preview with the SELECT block inside the file first. |
| **Enum expansion** | `facts.type` expanded from 8 → 18 values. `edges.relationship_type` expanded from 7 → 9 values. No DB migration needed (columns are `text`). Updated extraction prompt (Output Shape + Enum Contracts), validation sets, and `TYPE_LABELS` in the profile page. See Deviation T. |
| **Full-context query system** | Replaced pgvector retrieval with a full vault serialisation approach. Created `src/lib/vault-context.ts` (`buildVaultContext`) and `src/lib/vault-cache.ts` (1-hour in-memory TTL cache). Query route now sends every person's complete facts/connections/conversations as a prompt-cached Anthropic system block. `retrieveContext` preserved but commented out in `retrieval.ts`. See Deviation X. |
| **Cache invalidation** | `src/inngest/functions/extract.ts` — calls `invalidateContext(user_id)` at the end of every successful extraction so the next query rebuilds the vault context with new data. |
| **Delete person** | New `DELETE /api/people/[id]` route. Deletes in FK-safe order: facts → conversation_participants → conversations → edges → sources → people, all in a Prisma transaction. Sources shared with other people's facts are excluded from deletion. `invalidateContext` called after success. New `src/components/delete-person-button.tsx` (two-tap confirmation, loading state, error display, navigates to `/people` on success). Button added to profile page with `border-t` divider. See Deviation Y. |
| **Constellation physics** | Node size range reduced from 4–12 px to 2–5 px (`nodeRelSize={1}`, `nodeVal` clamp 4–25). Physics tuned: `linkStrength=0.7` and `linkDistance=60` applied via `d3Force` ref (not typed as direct props); `d3AlphaDecay={0.02}`, `d3VelocityDecay={0.2}`, `warmupTicks={100}`, `cooldownTicks={200}`. See Deviation Z. |
| **Updated query system prompt** | `src/lib/prompts/query.ts` rewritten to reflect full vault access. Added rule to traverse connections for relational questions ("who knows who," "who shares a location"). Removed retrieved-facts language. |

---

## 1c. Work Completed — Feedback Feature (2026-06-12)

In-app feedback button + private admin intake, built outside the formal plan.

| Item | Summary |
|------|---------|
| **`feedback` table** | New `Feedback` model / `feedback` table: `id` uuid PK, `user_id` FK → `users.id` (NOT NULL), `message` text NOT NULL, `page` text nullable, `status` text NOT NULL default `'new'` (values `new`/`reviewed`), `user_agent` text nullable, `created_at` timestamptz default `now()`. Indexes `idx_feedback_user_id`, `idx_feedback_created_at`. RLS enabled with no policies (deny-all backstop, same convention as the other 7 tables). Migration `20260612090000_add_feedback`. |
| **`POST /api/feedback`** | `src/app/api/feedback/route.ts` — auth-gated (401), validates message (400 `MESSAGE_REQUIRED` / `MESSAGE_TOO_LONG`, max 2,000 chars trimmed), inserts `{ user_id, message, page, user_agent }`, returns 201. **Never logs the message body** (same privacy rule as `raw_text`). Does **not** touch any usage counter — feedback is free and unmetered. |
| **`GET /api/feedback`** | Same route file, admin only. Checks `clerkId` against `ADMIN_CLERK_IDS` via `src/lib/admin.ts` (`isAdminClerkId`); non-admins get 403 with no data. Returns all rows newest-first, each joined with the submitter's email. |
| **`src/components/feedback-button.tsx`** | `'use client'`. Terracotta pill (`var(--brand)`, existing tokens only — no new hex), fixed lower-left at `left: 16px`, `bottom: calc(var(--nav-height) + 16px + env(safe-area-inset-bottom))` so it clears the bottom nav on phones with home bars. Opens a night-styled bottom sheet (same pattern as the constellation node sheet): autofocused textarea (maxLength 2000), Send with loading state, error state with retry, success state "Thanks — got it." that auto-closes after 1.4s. Submits `page: "network"` + `navigator.userAgent`. |
| **Placement** | Rendered **only** in `src/app/(app)/network/page.tsx` — in both the empty state and the constellation state. Absent from People, Query, and Account. |
| **Admin page** | `src/app/(app)/admin/feedback/page.tsx` — server component. `getAuthenticatedUser` + `isAdminClerkId`; unauthenticated or non-admin visitors get `notFound()` (404 — page never reveals it exists). Renders cards newest-first: message prominent, then email · date/time · page · status, using cream surfaces with a terracotta left-accent border. |
| **`ADMIN_CLERK_IDS`** | New server-only env var (comma-separated Clerk user IDs). Placeholder added to `.env.example`. **Must be set in `.env.local` and in Vercel project env before the admin page/API work in production.** Never expose with a `NEXT_PUBLIC_` prefix. |

**Out of scope / future:** email or push notification on new feedback; a "mark reviewed" action on the admin page (the `status` column is already in place for it); feedback button on pages other than the graph.

---

## 2. Current File State

### Created across all sessions

| File | Purpose |
|------|---------|
| `src/app/(app)/error.tsx` | `'use client'` error boundary for authenticated shell |
| `src/app/(app)/people/loading.tsx` | People list skeleton |
| `src/app/(app)/people/[id]/loading.tsx` | Person profile skeleton |
| `src/app/(app)/network/loading.tsx` | Dark-background loading state for network page |
| `src/app/(app)/account/loading.tsx` | Account page skeleton |
| `src/app/api/graph/route.ts` | `GET /api/graph` — nodes + edges for constellation |
| `src/app/api/stripe/checkout/route.ts` | `POST` — creates Stripe customer + Checkout session |
| `src/app/api/webhooks/stripe/route.ts` | `POST` — verifies signature, handles 3 subscription events |
| `src/components/constellation.tsx` | Force-directed graph — fetch, render, visual props, bottom sheet |
| `src/components/delete-person-button.tsx` | Two-tap confirm delete; calls `DELETE /api/people/[id]`; navigates to `/people` |
| `src/components/upgrade-button.tsx` | `'use client'` — calls checkout or portal API, redirects |
| `src/lib/stripe.ts` | Lazy Stripe singleton via `getStripe()` |
| `src/lib/vault-cache.ts` | In-memory 1-hour TTL cache for vault context strings |
| `src/lib/vault-context.ts` | `buildVaultContext(userId)` — serialises full vault to prompt-cached text block |
| `prisma/migrations/20260606000000_stripe_customer_id/migration.sql` | Adds `stripe_customer_id TEXT UNIQUE` to `users` |
| `prisma/migrations/20260606120000_rls/migration.sql` | Enables RLS on all 7 tables |
| `scripts/cleanup-ghost-people.sql` | One-time cleanup: deletes people with 0 facts/edges/conversations |

### Modified — key changes by file

| File | Cumulative changes |
|------|-------------------|
| `src/app/page.tsx` | Dark landing page replacing Next.js boilerplate |
| `src/app/(app)/network/page.tsx` | Empty state + `<Constellation />` |
| `src/app/(app)/account/page.tsx` | Full account page with plan, people count, upgrade CTA |
| `src/app/(app)/people/[id]/page.tsx` | Added `TYPE_LABELS` for all 18 fact types; added `<DeletePersonButton>` |
| `src/app/api/people/route.ts` | 15-person free-tier gate on `POST` (constant in `src/lib/limits.ts`) |
| `src/app/api/people/[id]/route.ts` | Added `DELETE` handler with transactional deletion + `invalidateContext` |
| `src/app/api/query/route.ts` | Full rewrite: uses `buildVaultContext` + `vault-cache`; Anthropic SDK direct with `cache_control: ephemeral`; streaming via `ReadableStream`; no longer calls `retrieveContext` or Voyage AI at query time |
| `src/components/add-person-form.tsx` | Detects 402, shows amber upgrade banner |
| `src/components/chat.tsx` | Empty-stream guard after stream closes |
| `src/components/constellation.tsx` | `mb-16` bottom sheet fix; node size 2–5 px; physics tuned via d3Force ref + direct props |
| `src/inngest/functions/extract.ts` | `primaryPersonName` param; no auto-create of secondary people rows; `invalidateContext(user_id)` at job end |
| `src/lib/claude.ts` | `extractFromSource` accepts optional `primaryPersonName` |
| `src/lib/prompts/extraction.ts` | Rule 8 (pronoun attribution); enum contracts expanded to 18 fact types / 9 edge types; Output Shape updated |
| `src/lib/prompts/query.ts` | Rewritten for full vault access; connection traversal rule added |
| `src/lib/retrieval.ts` | Query rewriting + name-based pre-fetch added; `retrieveContext` function now commented out (superseded by `buildVaultContext`) |
| `src/lib/validation/extraction.ts` | `STANDALONE_PRONOUNS` blocklist; `VALID_FACT_TYPES` 8→18; `VALID_RELATIONSHIP_TYPES` 7→9 |
| `src/proxy.ts` | `/api/webhooks/stripe` added to public routes |
| `prisma/schema.prisma` | `stripe_customer_id String? @unique @db.Text` on `User` |

### Deleted

| File | Reason |
|------|--------|
| `src/app/api/test/route.ts` | Unauthenticated `SELECT 1` debug endpoint — security risk, no longer needed |

### Unchanged from original build

| File | Purpose |
|------|---------|
| `src/app/(app)/layout.tsx` | Auth shell — upserts user row, renders nav |
| `src/app/(app)/people/page.tsx` | People list |
| `src/app/(app)/people/new/page.tsx` | Add person page |
| `src/app/(app)/query/page.tsx` | Query page — branches on peopleCount |
| `src/app/api/people/[id]/status/route.ts` | Processing status polling |
| `src/app/api/inngest/route.ts` | Serves both Inngest functions |
| `src/components/nav.tsx` | Fixed bottom nav, 4 tabs |
| `src/components/person-card.tsx` | Tappable card |
| `src/components/processing-indicator.tsx` | Polls status, shows failed state |
| `src/components/empty-vault-query.tsx` | Empty state for query page |
| `src/lib/auth.ts` | `getAuthenticatedUser()` |
| `src/lib/prisma.ts` | Prisma singleton |
| `src/inngest/client.ts` | Inngest singleton |
| `src/inngest/functions/embed.ts` | Embedding + shared-interest edges |

---

## 3. Deviations from the Implementation Plan

### A–K (carried forward from session 1)
- **A.** Prisma accessors are singular camelCase: `prisma.user`, `prisma.people`, `prisma.source`, `prisma.fact`, `prisma.conversation`, `prisma.conversationParticipant`, `prisma.edge`
- **B.** Inngest 4.5 uses 2-argument `createFunction(options, handler)` — trigger inside options as `triggers: [{ event: '...' }]`
- **C.** Step 31 (validation layer) built as dependency of Step 30 — already done, skip it
- **D.** Steps 26 and 27 built out of order
- **E.** ~~`@ai-sdk/openai` added~~ — superseded by Deviation G
- **F.** DM §7.3 `ORDER BY status DESC` corrected to `ASC` (`'confirmed' < 'raw'` alphabetically)
- **G.** OpenAI replaced with Voyage AI — dimension 1024, `VOYAGE_API_KEY` required, migration `20260605000000_voyage_embeddings` applied
- **H.** Embed job uses per-fact `step.run` instead of single batch step
- **I.** `/api/inngest` added to `isPublicRoute` in `src/proxy.ts`
- **J.** Vercel AI SDK v6 breaking changes — raw `fetch + ReadableStream` instead of `useChat`
- **K.** Cosine distance threshold widened from 0.4 to 0.5

### L–R (carried forward from session 2026-06-06)

- **L.** Phase 6 was skipped and then completed in full before Phase 7 resumed. All work is clean.
- **M.** Bottom sheet requires `mb-16` to clear the fixed nav bar.
- **N.** Stripe singleton must be lazily initialised — `getStripe()` function, not module-scope `new Stripe(...)`.
- **O.** Prisma migrations must be applied manually — `prisma db execute --file` + `prisma migrate resolve --applied`. Never `migrate dev` (shadow DB lacks pgvector).
- **P.** `$queryRaw` tagged template conflicts with `::vector` cast (Prisma v7). Use `$queryRawUnsafe(sql, ...params)` everywhere.
- **Q.** Extraction pipeline pronoun attribution — three-layer fix (prompt Rule 8 + `primaryPersonName` user message injection + `STANDALONE_PRONOUNS` validation blocklist).
- **R.** Stripe portal route not yet implemented — `POST /api/stripe/portal` returns 404. Must be built before Step 52.

### S. Query retrieval: name matching + query rewriting (2026-06-08)

`retrieveContext` in `src/lib/retrieval.ts` was enhanced with two strategies before being superseded:
1. **Query rewriting** — calls Claude Haiku to convert the user's question into fact-space keywords before embedding (e.g. "Tell me about Jordan Park" → "Jordan Park role org location interests background context"). Falls back silently to the original query on error.
2. **Name-based pre-fetch** — any person whose name appears in the query (full-name substring match OR first-name word match if ≥ 4 chars) has all their facts included regardless of cosine distance. First-name uses word-boundary matching via `\W+` split to avoid false substring matches.

Note: `retrieveContext` is now commented out — superseded by Deviation X. The name-matching logic is preserved for potential hybrid re-activation.

### T. Enum expansion — facts.type and edges.relationship_type

`facts.type` expanded from 8 to 18 legal values:
```
role, org, location, interest, background, context, connection, quote,
life_situation, religion, contact_info, personality, values, skills,
needs, future_plans, dates, miscellaneous
```

`edges.relationship_type` expanded from 7 to 9 legal values:
```
colleagues, co_investors, collaborators, introduced_by, shared_interest,
classmates, co_founders, friends, siblings
```

No DB migration needed — both columns are `TEXT` type. Updated files: `src/lib/prompts/extraction.ts` (Output Shape JSON + Enum Contracts section), `src/lib/validation/extraction.ts` (both Sets), `src/app/(app)/people/[id]/page.tsx` (`TYPE_LABELS` map).

### U. Person resolution fix — no auto-creation of secondary people

The extract job's Step 4 (`resolve-people`) previously created a `people` row for every name Claude mentioned (connections, participants, people in edges). This caused ghost rows for people never explicitly added by the user.

Fix: `personIdMap` is now seeded only with the primary person (from the form) and existing vault members. Names absent from the map are silently skipped by the existing `continue` guards in Steps 5–6. Connection facts about the primary person still write normally (their `person_name` resolves to the primary person's ID).

Run `scripts/cleanup-ghost-people.sql` to remove existing ghost rows (people with 0 facts, 0 edges, 0 conversation_participants).

### V. RLS was never enabled (Step 11 skipped)

All 7 tables were created without `ENABLE ROW LEVEL SECURITY`. Migration `20260606120000_rls` applied manually. 

**Important nuance:** The app connects as the postgres superuser (via Prisma) which bypasses RLS by design — app queries are unaffected. RLS blocks access via the Supabase `anon` and `authenticated` roles (e.g. direct Supabase JS client calls). The Supabase SQL editor also runs as superuser and will still show all rows — this is correct admin behaviour. To verify RLS is working: `SET ROLE anon; SELECT * FROM people; RESET ROLE;` — should return 0 rows.

### W. Security audit — `/api/test` deleted

Audited all 10 `src/app/api/` routes during the Step 51 security review. Found one unprotected endpoint: `GET /api/test` (unauthenticated `SELECT 1` connectivity check from Step 14). Deleted. All remaining routes call `getAuthenticatedUser()` as their first step. Three routes are intentionally exempt from `getAuthenticatedUser()`: `/api/inngest` (signing key), `/api/webhooks/stripe` (signature verification), `/api/user` (bootstraps the DB row — uses Clerk `auth()` directly).

### X. Full-context query system replaces pgvector retrieval

The query flow was rebuilt to send the user's entire vault to Claude as a prompt-cached system block, rather than retrieving top-20 facts via pgvector.

**New modules:**
- `src/lib/vault-context.ts` — `buildVaultContext(userId)` fetches all active people + their facts/conversations/edges in parallel, serialises to structured plain text. Returns `''` for empty vaults.
- `src/lib/vault-cache.ts` — module-level `Map` with 1-hour TTL. Exports `getCachedContext`, `setCachedContext`, `invalidateContext`. Cache is invalidated at the end of each successful extract job.

**Query route changes:**
- Removed `retrieveContext` call and Voyage AI embedding at query time
- Uses Anthropic SDK directly (not Vercel AI SDK) to pass system as an array with `cache_control: { type: 'ephemeral' }` on the vault block
- Streams response via `ReadableStream` of raw UTF-8 text deltas — identical wire format to the previous `toTextStreamResponse()`, no client changes needed

**`retrieveContext` preserved but commented out** in `src/lib/retrieval.ts` with reactivation instructions. Keep the file.

**Note on Voyage AI:** `VOYAGE_API_KEY` and `embedText()` are still required — the extraction pipeline still embeds facts for the constellation shared-interest computation. They are no longer used at query time.

### Y. Delete person — outside plan

`DELETE /api/people/[id]` added. Deletion order within a Prisma transaction:
1. `facts` where `person_id = id`
2. `conversation_participants` where `person_id = id`
3. `conversations` where `id IN (pre-fetched conversation IDs)`
4. `edges` where `person_a = id OR person_b = id` — **must precede sources** because `edges.source_id → sources.id`
5. `sources` where `id IN (candidate source IDs)`, filtered to exclude any source that another person's facts still reference
6. `people` row

`invalidateContext(userId)` called after transaction succeeds.

`src/components/delete-person-button.tsx` — state machine: `idle → confirming → deleting`. Two taps required. Navigates to `/people` on success.

### Z. Constellation physics and node size tuning

**Node size** — reduced from 4–12 px to 2–5 px:
- `nodeRelSize={1}` (was default 4)
- `nodeVal` clamp changed from `Math.max(1, Math.min(9, factCount))` to `Math.max(4, Math.min(25, factCount + 4))`
- `nodeCanvasObject` label offset updated to match: `sqrt(val) * 1`

**Physics props** — `linkStrength` and `linkDistance` are **not typed as direct props** on `react-force-graph-2d@1.29.1`. They must be set via a `useRef` + `useEffect`:
```ts
const fgRef = useRef<any>(null);
useEffect(() => {
  const link = fgRef.current?.d3Force('link');
  if (!link) return;
  link.strength(0.7);
  link.distance(60);
}, []);
```
Pass `ref={fgRef}` to `<ForceGraph2D>`. The following ARE typed direct props and work normally: `d3AlphaDecay={0.02}`, `d3VelocityDecay={0.2}`, `warmupTicks={100}`, `cooldownTicks={200}`.

---

## 4. Known Issues and Watch-Outs

### ~~Query threshold — alias queries may not match~~ (resolved)

Previously an issue with pgvector cosine distance. No longer relevant — the full-context approach sends all facts to Claude, so alias queries ("a16z" vs "Andreessen Horowitz") now resolve correctly.

### ~~`processing_status` reaches `complete` before embeddings are written~~ (resolved 2026-06-16)

As of the §0 pipeline fix, the **embed** job now owns the `complete` write, so
`complete` only happens after embeddings *and* shared-interest edges are written.
The status indicator no longer clears ahead of the network view. (Trade-off: an
embed failure now flips the source to `failed` — see §0 "Behavior change".)

### Source → person linking is user-scoped, not person-scoped

Profile page and status route query most recent source by `user_id`, not `person_id`. Could show wrong status/raw text for users with many people. Acceptable V1 limitation.

### Stripe portal route missing

See Deviation R. Add `src/app/api/stripe/portal/route.ts` before Step 52. Pattern mirrors the checkout route. Use `stripe.billingPortal.sessions.create({ customer: stripeCustomerId, return_url: origin + '/account' })`.

### `STRIPE_PRICE_ID` must be set

The checkout route reads `process.env.STRIPE_PRICE_ID`. Must be set in `.env.local` and Vercel. Missing = runtime Stripe error.

### Ghost people rows may exist in production

The person resolution fix (Deviation U) prevents new ghost rows. Existing ones should be cleaned up with `scripts/cleanup-ghost-people.sql`. Preview the SELECT before running the DELETE.

### Vault context cache is instance-local

`vault-cache.ts` uses a module-level `Map`. On Vercel, multiple serverless instances run independently — cache invalidation via `invalidateContext` only clears the cache on the instance that ran the extract job. Other instances will serve stale context until their TTL expires (1 hour). Acceptable for V1.

---

## 5. Environment Variables — Full Current State

| Variable | Used by | Status |
|----------|---------|--------|
| `DATABASE_URL` | Prisma (pooled, port 6543) | Set before Phase 1 |
| `DIRECT_URL` | Prisma migrations (direct, port 5432) | Set before Phase 1 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk client | Set before Phase 2 |
| `CLERK_SECRET_KEY` | Clerk server | Set before Phase 2 |
| `ANTHROPIC_API_KEY` | `extractFromSource()` (Haiku), `rewriteQuery()` (Haiku, inactive), query route (Sonnet direct) | Set before Phase 4 |
| `INNGEST_SIGNING_KEY` | Inngest `serve()` handler | Set before Phase 4 |
| `INNGEST_EVENT_KEY` | Inngest client | Set before Phase 4 |
| `VOYAGE_API_KEY` | `embedText()` — fact embedding in extract pipeline and shared-interest computation | Added Phase 4 — **still required** even though query no longer uses embeddings |
| `STRIPE_SECRET_KEY` | `getStripe()` | Added Phase 7 (Step 48) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification | Added Phase 7 (Step 48) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Available client-side | Added Phase 7 (Step 48) |
| `STRIPE_PRICE_ID` | Checkout session line item | **Must be set** — Pro plan price ID from Stripe dashboard |
| `NEXT_PUBLIC_POSTHOG_KEY` | posthog-js (client) + posthog-node (server events) | Added 2026-06-11 (PostHog integration) |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog API host (`https://us.i.posthog.com`) | Added 2026-06-11 |
| `ADMIN_CLERK_IDS` | `isAdminClerkId()` — gates `GET /api/feedback` and `/admin/feedback` | **Must be set in `.env.local` and Vercel** — comma-separated Clerk user IDs; server-only |

---

## 6. Prisma Model Accessor Reference

| Schema model | Prisma accessor | DB table |
|---|---|---|
| `User` | `prisma.user` | `users` |
| `People` | `prisma.people` | `people` |
| `Source` | `prisma.source` | `sources` |
| `Fact` | `prisma.fact` | `facts` |
| `Conversation` | `prisma.conversation` | `conversations` |
| `ConversationParticipant` | `prisma.conversationParticipant` | `conversation_participants` |
| `Edge` | `prisma.edge` | `edges` |

`User` model includes `stripe_customer_id String? @unique @db.Text`. The `Fact.person` relation field is named `person` (singular). Edge model exposes `personA` and `personB` as relation fields (select `{ name: true }` to get connected person's name).

---

## 7. Remaining Work

### Step 50 — Mobile testing and responsive polish

**Status:** Not started.

Test on a real iOS device and a real Android device:
- **Add Person form** — virtual keyboard can obscure fixed-bottom inputs. Check `visualViewport` resize.
- **Graph touch** — canvas touch pan/pinch-zoom may conflict with browser scroll. May need `touch-action: none` on the canvas wrapper in `constellation.tsx`.
- **Bottom sheet** — verify `mb-16` clears the nav on devices with safe area insets (iPhone home bar adds extra height).
- **Text readability** — all pages at 390px width.

### Stripe portal route (pre-requisite for Step 52)

**File to create:** `src/app/api/stripe/portal/route.ts`

```ts
// POST — creates a Stripe Customer Portal session and returns { url }
// Auth-gated. Requires user to have stripe_customer_id set.
```

Pattern mirrors `src/app/api/stripe/checkout/route.ts`. Use `stripe.billingPortal.sessions.create({ customer: stripeCustomerId, return_url: origin + '/account' })`.

### Step 51 — Security review

**Status:** Partially complete.

Already done this session:
- ✅ Every `src/app/api/` route calls `getAuthenticatedUser()` first (audit complete, test route deleted)
- ✅ RLS policies enabled on all 7 tables

Still to verify:
- `ANTHROPIC_API_KEY` absent from client-side JS bundle (check Network tab in browser devtools)
- No `raw_text` in Vercel logs
- No route returns data without `user_id` scoping (spot-check)
- `/api/webhooks/stripe` signature verified — confirm `STRIPE_WEBHOOK_SECRET` matches production webhook in Stripe dashboard

### Step 52 — End-to-end production smoke test

**Status:** Not started. Blocked on Steps 50–51 and the portal route.

On the live production URL:
1. Create account via Google sign-in → `users` row created
2. Add two people with rich notes mentioning a connection → both reach `processing_status = complete`
3. Query returning both people → streamed, attributed answer using full vault context
4. `/network` → both nodes connected, tap node → bottom sheet → "View profile" → correct profile
5. Delete one person → confirm they disappear from people list, network graph, and query responses
6. All four flows on a real phone in production

### Ghost people cleanup

Before or during Step 52, run the preview SELECT in `scripts/cleanup-ghost-people.sql` against production to see if any ghost rows exist, then run the DELETE if needed.

---

## 8. Migration History

| Migration | Applied via |
|---|---|
| `20260530161704_init` | `prisma migrate dev` |
| `20260530180000_indexes` | `prisma migrate dev` |
| `20260605000000_voyage_embeddings` | `db execute` + `migrate resolve` |
| `20260606000000_stripe_customer_id` | `db execute` + `migrate resolve` |
| `20260606120000_rls` | `db execute` + `migrate resolve` |
| `20260611120000_usage_limits` | hand-written SQL + `migrate deploy` |
| `20260612090000_add_feedback` | hand-written SQL + `migrate deploy` |

**Future migrations:** hand-write `prisma/migrations/<timestamp>_<name>/migration.sql`, then `npx prisma migrate deploy` + `npx prisma generate`. Never `migrate dev` (shadow DB lacks pgvector). `migrate deploy` is simpler than the older `db execute` + `migrate resolve` flow and keeps the history table in sync automatically.

---

## 9. Preview verification plan — intake pipeline fix (2026-06-16)

**Branch:** `fix/intake-pipeline-failure` (pushed to `cadendane-droid/network-vault`). Pushing it triggers a Vercel preview automatically — find the URL in the Vercel dashboard → Deployments → this branch.

**Verify script:** `npx tsx scripts/verify-pipeline.ts <email-or-personId>`
- Pass a `people.id` UUID to check one person, or an email to check all of that user's people.
- Needs `DATABASE_URL` in env (`vercel env pull` writes `.env.local`, which the script auto-loads).
- Prints PASS/FAIL for: latest source `processing_status='complete'`; fact count > 0; zero NULL embeddings; embedding dimension = 1024. Exits non-zero on any FAIL. Read-only.

### Manual checklist (run against the PREVIEW, in order)

**0. Check the preview's database first.** Confirm whether the Vercel **preview** env points at the **production Supabase** or a separate DB (check `DATABASE_URL`/`DIRECT_URL` for the Preview environment in Vercel project settings). **If it shares prod, every test record lands in prod** — so use a **throwaway test account/email** for all testing below, and do **not** reprocess Bridget's real record until step 5.

**1. Happy path.** Sign in with the test account; add a person with a deliberately long, rich **~250-word** note mentioning a role, an org, a location, two interests, and a connection to another named person (representative of the real failure — a long note was the likely 4096-token-overflow trigger).
- Inngest dashboard: both `extract-person-facts` (`extractPersonFacts`) and `embed-person-facts` (`embedPersonFacts`) runs succeed, no terminal failure.
- `npx tsx scripts/verify-pipeline.ts <test-personId>` → all PASS.
- PostHog: `processing_completed` fires.
- A natural-language query returns an attributed answer.

**2. Forced failure.** Add a person with a garbage or oversized note intended to break extraction. Confirm the source flips to `failed` and the UI shows the **"Processing failed… / Try again"** state (not an endless spinner). Click **Try again** → it reprocesses and resumes polling.

**3. Reprocess (no duplicate facts).** On a stuck/failed **test** record, trigger the reprocess path (the UI button, or `POST /api/people/[id]/reprocess`). Confirm it reaches `complete` and the verify script shows a **sane, non-doubled** fact count.

**4. Loose thread — confirm the diagnosis with runtime evidence.** In the Inngest dashboard, open the run history for Bridget's **original** failed `vault/person.created` job (**June 13, ~15:51 UTC**). Read which step threw — confirm it was `validate` or a `write-*` step, and note whether that input would have exceeded the old **4096**-token ceiling. This turns the diagnosis from "plausible" to "confirmed."

**5. Production recovery (ONLY after 1–4 pass).** Merge to `main`, deploy, then reprocess Bridget's **real** source via the admin endpoint:
```bash
curl -X POST https://<prod-host>/api/admin/reprocess \
  -H 'Content-Type: application/json' \
  -b '<authenticated admin session cookie>' \
  -d '{"source_id":"<bridget-source-uuid>","person_id":"<bridget-person-uuid>"}'
```
Then `npx tsx scripts/verify-pipeline.ts <bridget-email-or-personId>` → expect all PASS.

**Production gates left to the operator:** merging to `main`, deploying to prod, running the verify script against a live DB, and reprocessing any real user's record (Bridget included) are all steps 5 / manual — not done from this machine.

---

## 10. Inngest stale-deployment-URL fix (2026-06-17)

Worked directly on `main` (no feature branch). Not pushed — operator will push.

### Symptom

After fixing event delivery (the bad `INNGEST_BASE_URL` that redirected sends to
almura.app was deleted, so runs now appear in the Inngest dashboard), every run
**failed before executing any step**: it went straight from start → Finalization
(the `onFailure` handler), with no `fetch-source`/`call-claude`/etc. in between.
The `onFailure` handler itself also failed, repeatedly. Expanding the error
showed **`DEPLOYMENT_NOT_FOUND` — "The deployment could not be found on Vercel."**

Net user-visible effect: `processing_status` never left `processing`; infinite
spinner. (This is a *transport* failure, separate from the §0 logic fix — the
functions were never actually entered, so none of the §0 step logic ran.)

### Root cause

Inngest invokes functions by calling back to the serve URL it recorded at
registration time. `serve()` in `src/app/api/inngest/route.ts` had **no
`serveOrigin`**, so it inferred the origin from the incoming request's `Host`
header. On Vercel, the sync/registration request arrives at the **per-deployment
URL** (`network-vault-<hash>.vercel.app`), not the stable domain. That URL is
replaced on every new deploy, so the recorded callback URL goes stale — Inngest
then calls a deployment that no longer exists and gets `DEPLOYMENT_NOT_FOUND`
before any step (or even the failure handler) can run.

### Fix

`src/app/api/inngest/route.ts` — pass `serveOrigin` to `serve()`, pinned to the
stable production domain on Vercel production:

```ts
const serveOrigin =
  process.env.INNGEST_SERVE_ORIGIN ??
  (process.env.VERCEL_ENV === 'production' ? 'https://www.almura.app' : undefined);

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [extractPersonFacts, embedPersonFacts],
  serveOrigin,
});
```

- In Inngest 4.5.0 the option is **`serveOrigin`** (the older `serveHost` was
  renamed). It overrides the inferred origin used when registering/invoking, so
  Inngest always calls back to `https://www.almura.app` regardless of which
  deployment handled the sync.
- Guarded on `VERCEL_ENV === 'production'` so local `inngest dev` and preview
  deploys still auto-infer their own origin (a hardcoded value would make the
  local dev server try to call the live site).
- `INNGEST_SERVE_ORIGIN` is an optional escape hatch to override the host
  without a code change (e.g. to pin a preview).

No function logic, prompts, or database code changed. `tsc --noEmit` and
`eslint` pass.

### After deploy — verify

1. Deploy `main` to production.
2. Trigger a re-sync so Inngest records the new origin: in the Inngest dashboard
   re-sync the app, or hit `PUT https://www.almura.app/api/inngest` (Vercel's
   Inngest integration also syncs automatically on deploy). Confirm the app's
   registered URL now reads `https://www.almura.app/api/inngest`, not a
   `*.vercel.app` hash URL.
3. Add a test person. The Inngest run should now execute steps
   (`fetch-source` → `call-claude` → …) instead of jumping to Finalization, and
   reach a terminal status. No more `DEPLOYMENT_NOT_FOUND`.
4. `processing_status` reaches `complete`; spinner clears.
