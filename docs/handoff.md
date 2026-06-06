# Network Vault — Session Handoff

**Date:** 2026-06-06  
**Starting point:** Phase 5 complete through Step 41 (query interface done). Phase 6 had been skipped.  
**Ending point:** Phase 6 fully complete (Steps 42–46). Phase 7 in progress — Steps 47–49 done, Steps 50–52 remaining. Several bugs fixed outside the plan.  
**Next step to pick up:** Step 50 — Mobile testing and responsive polish

---

## 1. Steps Completed This Session

| Step | Summary |
|------|---------|
| **42** | `GET /api/graph` at `src/app/api/graph/route.ts` — auth-gated, returns `{ nodes, edges }`. Nodes include `id`, `name`, `factCount`, `hasConfirmedFacts`, `role`, `org` (role and org added during Step 45 so the bottom sheet has context without an extra fetch). Edges renamed `person_a`/`person_b` → `source`/`target` for react-force-graph-2d. |
| **43** | Installed `react-force-graph-2d@1.29.1`. Created `src/components/constellation.tsx` — `'use client'`, dynamic import with `ssr: false`, fetches from `/api/graph`, `ResizeObserver` for dimensions, `useMemo` for stable graph data reference (prevents simulation restart on re-render), loading and error states, `linkLineDash` for dashed inferred edges. |
| **44** | Graph visual properties — `nodeVal` maps factCount (clamped 1–9) to radius 4–12 px via library formula `sqrt(val) * nodeRelSize`. `nodeCanvasObject` in `'after'` mode draws name labels at zoom > 1.5 (font scales inversely with globalScale for constant apparent size). `linkLabel` shows relationship_type on edge hover. `cooldownTicks={100}` stops physics simulation after settling. |
| **45** | Node click → bottom sheet. Updated `GET /api/graph` to include `role` and `org` on nodes (confirmed-first via `orderBy: [{ status: 'asc' }]`). Bottom sheet uses `fixed inset-0 z-50 flex items-end mb-16` — the `mb-16` clears the fixed bottom nav. Shows name, role, org (or fact count fallback). Backdrop tap or × dismisses, "View profile" Link navigates to `/people/[id]`. |
| **46** | `src/app/(app)/network/page.tsx` — server component, counts active people, shows empty state for < 2 people (copy distinguishes 0 vs 1 person, violet CTA), renders `<Constellation />` in `h-[calc(100dvh-4rem)]` for ≥ 2 people. |
| **47** | Error boundaries and loading states. Created `src/app/(app)/error.tsx` (`'use client'` boundary, shows error message + "Try again" button). Created `people/loading.tsx`, `people/[id]/loading.tsx`, `network/loading.tsx` skeletons. Fixed silent `streamText` failure in `chat.tsx` — empty-stream guard sets error string if assistant content is empty after stream closes (Deviation J watch-out from previous handoff). |
| **48** | Stripe billing. Added `stripe_customer_id` to `User` schema (migration applied manually — see Deviation O). Created `src/lib/stripe.ts` (lazy `getStripe()` singleton — see Deviation N), `src/app/api/stripe/checkout/route.ts`, `src/app/api/webhooks/stripe/route.ts` (handles 3 subscription events), `src/components/upgrade-button.tsx`, full `src/app/(app)/account/page.tsx`. Added `/api/webhooks/stripe` to public routes in `proxy.ts`. |
| **49** | Free-tier limits. Added 25-person gate to `POST /api/people` (counts active + archived; Pro skips; returns 402). `add-person-form.tsx` detects 402 and shows amber upgrade banner with link to `/account`. Account page now shows people count + progress bar (violet → amber → red as limit approaches). Added `account/loading.tsx`. |

### Bugs fixed outside the plan

| Bug | Files changed | Fix |
|-----|--------------|-----|
| **Landing page was Next.js boilerplate** | `src/app/page.tsx` | Replaced with dark landing page — server-side auth check redirects authenticated users to `/people`; unauthenticated users see wordmark, one-line description, "Get started" → `/sign-up`, "Sign in" → `/sign-in` |
| **Ghost people rows from pronoun extraction** | `src/lib/prompts/extraction.ts`, `src/lib/claude.ts`, `src/inngest/functions/extract.ts`, `src/lib/validation/extraction.ts` | Three-layer fix: (1) Rule 8 added to system prompt; (2) `Primary subject: [Name]` injected into the user message via new `primaryPersonName` param on `extractFromSource` (not system prompt — preserves caching); (3) `STANDALONE_PRONOUNS` blocklist in validation rejects facts/edges where person_name is He/She/They/Him/Her/His/Hers/It/etc. |
| **Query returning "Something went wrong"** | `src/app/api/query/route.ts`, `src/lib/retrieval.ts` | Added try/catch around `retrieveContext` so retrieval errors return a proper 500 before the stream starts. Added `onError` to `streamText` to log model errors. Root cause: Prisma v7's `$queryRaw` tagged template conflicts with `::vector` cast after a `$N` placeholder. Switched to `$queryRawUnsafe(sql, ...params)`. Confirmed with isolated `pg.Pool.query` test which succeeded. |
| **Stripe build failure** | `src/lib/stripe.ts`, `src/app/api/stripe/checkout/route.ts`, `src/app/api/webhooks/stripe/route.ts` | `new Stripe(...)` at module scope ran during Next.js build when env var was absent. Changed to lazy `getStripe()` function — client only created on first runtime call. |
| **Bottom sheet behind nav bar** | `src/components/constellation.tsx` | Added `mb-16` to the sheet panel so it clears the 4rem fixed bottom nav. |

---

## 2. Current File State

### Created this session

| File | Purpose |
|------|---------|
| `src/app/(app)/error.tsx` | `'use client'` error boundary for authenticated shell |
| `src/app/(app)/people/loading.tsx` | People list skeleton |
| `src/app/(app)/people/[id]/loading.tsx` | Person profile skeleton |
| `src/app/(app)/network/loading.tsx` | Dark-background loading state for network page |
| `src/app/(app)/account/loading.tsx` | Account page skeleton |
| `src/app/api/graph/route.ts` | `GET /api/graph` — nodes + edges for constellation |
| `src/app/api/stripe/checkout/route.ts` | `POST` — creates Stripe customer + Checkout session |
| `src/app/api/webhooks/stripe/route.ts` | `POST` — verifies signature, handles subscription events |
| `src/components/constellation.tsx` | Full graph component — fetch, render, visual props, bottom sheet |
| `src/components/upgrade-button.tsx` | `'use client'` — calls checkout or portal API, redirects |
| `src/lib/stripe.ts` | Lazy Stripe singleton via `getStripe()` |
| `prisma/migrations/20260606000000_stripe_customer_id/migration.sql` | Adds `stripe_customer_id TEXT UNIQUE` to users |

### Modified this session

| File | Change |
|------|--------|
| `src/app/page.tsx` | Replaced Next.js boilerplate — dark landing page with auth redirect |
| `src/app/(app)/network/page.tsx` | Replaced placeholder — empty state + `<Constellation />` |
| `src/app/(app)/account/page.tsx` | Replaced placeholder — full account page |
| `src/app/api/people/route.ts` | Added 25-person free-tier gate |
| `src/app/api/query/route.ts` | try/catch around retrieval, `onError` on streamText |
| `src/components/add-person-form.tsx` | Detects 402, shows amber upgrade banner |
| `src/components/chat.tsx` | Empty-stream guard after stream closes |
| `src/components/constellation.tsx` | `mb-16` on bottom sheet panel |
| `src/lib/claude.ts` | `extractFromSource` accepts optional `primaryPersonName` |
| `src/lib/retrieval.ts` | `$queryRaw` → `$queryRawUnsafe(sql, ...params)` |
| `src/lib/prompts/extraction.ts` | Rule 8 (pronoun attribution), updated all 3 few-shot examples |
| `src/lib/validation/extraction.ts` | `STANDALONE_PRONOUNS` blocklist |
| `src/inngest/functions/extract.ts` | Passes `primaryPerson.name` to `extractFromSource` |
| `src/proxy.ts` | Added `/api/webhooks/stripe` to public routes |
| `prisma/schema.prisma` | Added `stripe_customer_id String? @unique @db.Text` to `User` |

### Carried forward unchanged

| File | Purpose |
|------|---------|
| `src/app/(app)/layout.tsx` | Auth shell — upserts user row, renders nav |
| `src/app/(app)/people/page.tsx` | People list |
| `src/app/(app)/people/new/page.tsx` | Add person page |
| `src/app/(app)/people/[id]/page.tsx` | Person profile |
| `src/app/(app)/query/page.tsx` | Query page — branches on peopleCount |
| `src/app/api/people/[id]/route.ts` | Full person profile shape |
| `src/app/api/people/[id]/status/route.ts` | Processing status polling |
| `src/app/api/inngest/route.ts` | Serves both Inngest functions |
| `src/components/nav.tsx` | Fixed bottom nav, 4 tabs |
| `src/components/person-card.tsx` | Tappable card |
| `src/components/processing-indicator.tsx` | Polls status, shows failed state |
| `src/components/empty-vault-query.tsx` | Empty state for query page |
| `src/lib/auth.ts` | `getAuthenticatedUser()` |
| `src/lib/prisma.ts` | Prisma singleton |
| `src/lib/prompts/query.ts` | `QUERY_SYSTEM_PROMPT` |
| `src/inngest/client.ts` | Inngest singleton |
| `src/inngest/functions/embed.ts` | Embedding + shared-interest edges |

---

## 3. Deviations from the Implementation Plan

Deviations A–K carry forward from previous handoffs unchanged.

### A–K (carried forward)
- **A.** Prisma accessors are singular camelCase: `prisma.user`, `prisma.people`, `prisma.source`, `prisma.fact`, `prisma.conversation`, `prisma.conversationParticipant`, `prisma.edge`
- **B.** Inngest 4.5 uses 2-argument `createFunction(options, handler)` — trigger inside options as `triggers: [{ event: '...' }]`
- **C.** Step 31 (validation layer) built as dependency of Step 30 — already done, skip it
- **D.** Steps 26 and 27 built out of order
- **E.** ~~`@ai-sdk/openai` added~~ — superseded by Deviation G
- **F.** DM §7.3 `ORDER BY status DESC` corrected to `ASC` (`'confirmed' < 'raw'` alphabetically)
- **G.** OpenAI replaced with Voyage AI — dimension 1024, `VOYAGE_API_KEY` required, migration `20260605000000_voyage_embeddings` applied
- **H.** Embed job uses per-fact `step.run` instead of single batch step
- **I.** `/api/inngest` added to `isPublicRoute` in `src/proxy.ts`
- **J.** Vercel AI SDK v6 breaking changes — raw `fetch + ReadableStream` instead of `useChat`, `toTextStreamResponse()`
- **K.** Cosine distance threshold widened from 0.4 to 0.5

### L. Phase 6 was skipped in the previous session

Phase 7 (Step 47) was started before catching that Phase 6 had been skipped. Phase 6 was completed in full (Steps 42–46) before resuming Phase 7. All work is clean.

### M. Bottom sheet requires `mb-16` to clear the nav

`fixed inset-0 flex items-end` places the panel flush with the viewport bottom, behind the fixed nav. Fixed: `mb-16` on the panel element lifts it 64px.

### N. Stripe singleton must be lazily initialised

`new Stripe(process.env.STRIPE_SECRET_KEY)` at module scope crashes the Vercel build. `src/lib/stripe.ts` exports `getStripe()` — client only created on first runtime call inside a handler.

### O. Prisma migrations must be applied manually (pgvector shadow DB issue)

`prisma migrate dev` cannot be used because the shadow database doesn't have the `pgvector` extension. All schema changes must: (1) write the SQL manually, (2) apply with `npx prisma db execute --file <path>`, (3) mark as applied with `npx prisma migrate resolve --applied <name>`. The `stripe_customer_id` migration followed this pattern.

### P. `$queryRaw` tagged template conflicts with `::vector` cast (Prisma v7)

Prisma v7's template literal processor mishandles PostgreSQL's `::` cast operator when it immediately follows a `$N` placeholder, causing `retrieveContext` to throw on every call. Diagnosed by running the identical SQL via `pg.Pool.query` (succeeded). Fixed in `src/lib/retrieval.ts` by switching to `$queryRawUnsafe(sql, ...params)`. Note: `$2` (vector) appears twice in the SQL — PostgreSQL supports positional parameter reuse.

### Q. Extraction pipeline pronoun attribution (three-layer fix)

Notes using pronouns ("He is a Partner at...") caused `person_name: "He"` facts and ghost `people` rows. Three-layer fix: (1) Rule 8 in extraction system prompt, (2) `Primary subject: [Name]` in user message via `primaryPersonName` param on `extractFromSource`, (3) `STANDALONE_PRONOUNS` blocklist in validation.

### R. Stripe portal route not yet implemented

`POST /api/stripe/portal` does not exist. Pro users clicking "Manage billing" receive a 404 shown as inline error in `UpgradeButton`. Must be added before Step 52 smoke test.

---

## 4. Known Issues and Watch-Outs

### Query threshold — alias queries may not match (e.g. "a16z" vs "Andreessen Horowitz")

A query for "Who do I know at a16z" returned no results even when a person has `org: Andreessen Horowitz`. The cosine distance between the alias and the full name may exceed 0.5. Options: widen threshold to 0.6 in `retrieval.ts`, add alias expansion, or document that queries should use full names. No fix applied.

### `processing_status` reaches `complete` before embeddings are written

Extract job marks `complete` before firing `vault/facts.extracted`. Embed job runs asynchronously. Immediate query after status clears may return nothing. Wait a few seconds after the indicator clears before querying in the Step 52 smoke test.

### Source → person linking is user-scoped, not person-scoped

Profile page and status route query most recent source by `user_id`, not `person_id`. Could show wrong status/raw text for users with many people. Acceptable V1 limitation.

### Stripe portal route missing

See Deviation R. Add `src/app/api/stripe/portal/route.ts` before Step 52.

### `STRIPE_PRICE_ID` must be set

The checkout route reads `process.env.STRIPE_PRICE_ID`. Must be set in `.env.local` and Vercel. Missing = runtime Stripe error.

---

## 5. Environment Variables — Full Current State

| Variable | Used by | Status |
|----------|---------|--------|
| `DATABASE_URL` | Prisma (pooled, port 6543) | Set before Phase 1 |
| `DIRECT_URL` | Prisma migrations (direct, port 5432) | Set before Phase 1 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk client | Set before Phase 2 |
| `CLERK_SECRET_KEY` | Clerk server | Set before Phase 2 |
| `ANTHROPIC_API_KEY` | `extractFromSource()` and `streamText()` | Set before Phase 4 |
| `INNGEST_SIGNING_KEY` | Inngest `serve()` handler | Set before Phase 4 |
| `INNGEST_EVENT_KEY` | Inngest client | Set before Phase 4 |
| `VOYAGE_API_KEY` | `embedText()` — extraction and query retrieval | Added Phase 4 |
| `STRIPE_SECRET_KEY` | `getStripe()` | Added Phase 7 (Step 48) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification | Added Phase 7 (Step 48) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Available client-side | Added Phase 7 (Step 48) |
| `STRIPE_PRICE_ID` | Checkout session line item | **Must be set** — Pro plan price ID from Stripe dashboard |

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

`User` model now includes `stripe_customer_id String? @unique @db.Text`. The `Fact.person` relation field is named `person` (singular).

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
// Add to public routes? No — must be authenticated.
```

Pattern mirrors the checkout route. Use `stripe.billingPortal.sessions.create({ customer: stripeCustomerId, return_url: origin + '/account' })`.

### Step 51 — Security review

**Status:** Not started. Checklist:
- Every `src/app/api/` route calls `getAuthenticatedUser()` first
- No route returns data without `user_id` scoping
- `ANTHROPIC_API_KEY` absent from client-side JS bundle (Network tab)
- RLS policies reject unauthenticated Supabase queries
- No `raw_text` in Vercel logs
- `/api/webhooks/stripe` is public but signature-verified — confirm `STRIPE_WEBHOOK_SECRET` matches production webhook in Stripe dashboard

### Step 52 — End-to-end production smoke test

**Status:** Not started. Blocked on Steps 50–51 and the portal route.

On the live production URL:
1. Create account via Google sign-in → `users` row created
2. Add two people with notes mentioning a connection → both reach `processing_status = complete`
3. Query returning both people → streamed, attributed answer
4. `/network` → both nodes connected, tap node → bottom sheet → "View profile" → correct profile
5. All four flows on a real phone in production

---

## 8. Migration History

| Migration | Applied via |
|---|---|
| `20260530161704_init` | `prisma migrate dev` |
| `20260530180000_indexes` | `prisma migrate dev` |
| `20260605000000_voyage_embeddings` | `db execute` + `migrate resolve` |
| `20260606000000_stripe_customer_id` | `db execute` + `migrate resolve` |

**Future migrations:** always use `prisma db execute --file` + `prisma migrate resolve --applied` — never `migrate dev` (shadow DB lacks pgvector).
