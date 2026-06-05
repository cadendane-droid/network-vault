# Network Vault — Session Handoff

**Date:** 2026-06-05  
**Starting point:** Phase 2 Step 19 complete (auth foundation done)  
**Ending point:** Step 30 complete (Steps 31 also covered — see deviations)  
**Next step to pick up:** Step 32 — Inngest embed job

---

## 1. Steps Completed This Session

| Step | Summary |
|------|---------|
| **20** | App shell layout (`src/app/(app)/layout.tsx`) with user upsert on load, bottom nav component, and placeholder pages for `/people`, `/query`, `/network`, `/account` |
| **21** | `POST /api/people` — creates a `people` row and a `source` row in a Prisma transaction, returns `{ person_id, source_id }` with 201 |
| **22** | `GET /api/people` — returns all people for the authenticated user ordered by `created_at DESC`, with confirmed fact count |
| **23** | Updated `POST /api/people` to update `processing_status` to `'processing'`, fire `vault/person.created` Inngest event, and return 202 |
| **24** | `GET /api/people/[id]` — full person profile: facts filtered to `raw/confirmed`, conversations via join table, edges in both directions with connected person resolved |
| **25** | Add Person form at `/people/new` — name input, source kind selector, date picker defaulting to today, free-form textarea, submits to `POST /api/people` and navigates to profile on 202 |
| **26** | People list page at `/people` — server component querying Prisma directly, `PersonCard` component with name and confirmed fact count, empty state with CTA |
| **27** | Person profile page at `/people/[id]` — facts grouped by type, conversations with date/summary, connections with relationship type, collapsible raw text, processing banner |
| **28** | Installed `@anthropic-ai/sdk`, `ai`, `@ai-sdk/openai`; created `src/lib/claude.ts` with Anthropic singleton, `extractFromSource()`, and `embedText()` |
| **29** | Extraction system prompt at `src/lib/prompts/extraction.ts` — full DM §6.1 output shape, all 7 DM §6.2 rules, all enum values with descriptions, 3 few-shot examples (conversation, note, profile) |
| **30** | Inngest extract job at `src/inngest/functions/extract.ts` — 8 Inngest steps: fetch → Claude → validate → resolve people → write facts → write edges (with dedup) → write conversation → mark complete → fire `vault/facts.extracted` |
| **31** | *(Covered inside Step 30)* Validation layer at `src/lib/validation/extraction.ts` — all 7 DM §6.3 rules, returns `{ validFacts, validEdges, invalid }`, invalid items logged not thrown |

---

## 2. Current File State

### Created this session

| File | Purpose |
|------|---------|
| `src/app/(app)/layout.tsx` | Authenticated app shell — verifies auth, upserts user row, renders bottom nav |
| `src/app/(app)/people/page.tsx` | People list — server component, queries Prisma, renders PersonCard list |
| `src/app/(app)/people/new/page.tsx` | Add person page — thin wrapper around AddPersonForm |
| `src/app/(app)/people/[id]/page.tsx` | Person profile page — facts by type, conversations, connections, raw text collapsible |
| `src/app/(app)/query/page.tsx` | Placeholder — heading only, built out in Step 40 |
| `src/app/(app)/network/page.tsx` | Placeholder — heading only, built out in Step 46 |
| `src/app/(app)/account/page.tsx` | Placeholder — heading only, built out in Step 48 |
| `src/app/api/people/route.ts` | `POST` (create person + source, fire Inngest event) and `GET` (list people with fact counts) |
| `src/app/api/people/[id]/route.ts` | `GET` — full person profile shape: facts, conversations, connections |
| `src/components/nav.tsx` | Client component — fixed bottom nav, 4 tabs, active state via `usePathname()` |
| `src/components/add-person-form.tsx` | Client component — controlled form, submits to API, navigates on success |
| `src/components/person-card.tsx` | Tappable card linking to `/people/[id]`, shows confirmed fact count or "Processing…" |
| `src/lib/claude.ts` | Anthropic singleton, `extractFromSource()`, `embedText()` |
| `src/lib/prompts/extraction.ts` | `EXTRACTION_SYSTEM_PROMPT` — the full extraction prompt with few-shot examples |
| `src/lib/validation/extraction.ts` | `validateExtractionOutput()` — all DM §6.3 rules, returns `{ validFacts, validEdges, invalid }` |
| `src/inngest/functions/extract.ts` | `extractPersonFacts` Inngest function — full 8-step extraction pipeline |

### Modified this session

| File | Change |
|------|--------|
| `src/app/api/inngest/route.ts` | Registered `extractPersonFacts` in the `functions` array |

---

## 3. Deviations from the Implementation Plan

### A. Prisma accessor for `Source` model is `prisma.source` not `prisma.sources`
The handoff document listed `sources table → prisma.sources`. The generated Prisma client uses the camelCase singular model name: `prisma.source`. All code in this session uses the correct accessor. **The handoff doc was wrong — ignore it for this model.**

The correct mapping (verified against generated client):
- `User` → `prisma.user`
- `People` → `prisma.people`
- `Source` → `prisma.source`
- `Fact` → `prisma.fact`
- `Conversation` → `prisma.conversation`
- `ConversationParticipant` → `prisma.conversationParticipant`
- `Edge` → `prisma.edge`

### B. Inngest 4.5 uses a 2-argument `createFunction`, not 3
Older Inngest docs show `createFunction(config, trigger, handler)`. In Inngest 4.5 the trigger moves into the config object as `triggers: [{ event: '...' }]`. The function signature is `createFunction(options, handler)`. All code in this session uses the correct 2-argument form.

### C. Step 31 (validation layer) covered inside Step 30
The implementation plan lists Step 31 as a separate step to create `src/lib/validation/extraction.ts`. That file was created as a dependency of Step 30 and fully implements all 7 DM §6.3 rules. **Skip Step 31 — it is done.**

### D. Steps 26 and 27 done out of order
Steps 25 → 26 → 27 is the planned order. The Add Person form (Step 25) navigated to `/people/[id]` after submit, which 404'd because the profile page didn't exist. Steps 26 and 27 were built immediately to unblock testing. All three steps meet their acceptance criteria.

### E. `@ai-sdk/openai` added as a dependency (not in original spec)
The schema uses `vector(1536)`, which is the dimension of OpenAI's `text-embedding-3-small`. Anthropic has no public embeddings API. The `ai` package alone doesn't include providers — `@ai-sdk/openai` is required for `embedText()`. This package was installed alongside `@anthropic-ai/sdk` and `ai`.

### F. DM §7.3 `ORDER BY status DESC` corrected to `ASC`
The data model doc says `ORDER BY status DESC` with the note "(confirmed first)". Alphabetically, `'confirmed' < 'raw'`, so DESC would put raw facts first — the opposite of the intent. All profile page queries use `status: 'asc'` to surface confirmed facts first.

---

## 4. Known Issues and Watch-Outs

### `OPENAI_API_KEY` is required before Step 32
`embedText()` calls `openai.embedding('text-embedding-3-small')`. This will throw at runtime if `OPENAI_API_KEY` is not set. **Add this to `.env.local` and Vercel before running Step 32.** The embedding step (Step 32) will fail silently in Inngest without it.

### The `vault/facts.extracted` event has no handler yet
The extract job fires `vault/facts.extracted` at the end of every run. Until Step 32's embed job is registered, this event is queued in Inngest but unhandled. This is expected — it will not cause errors.

### Person profile page shows the user's most recent source as raw text, not the source for that person
In `src/app/(app)/people/[id]/page.tsx`, the `latestSource` query fetches the most recent source by `user_id` — not by `person_id`. This is a placeholder until source-to-person linking is wired up more precisely. For V1 with one person added at a time, this is fine. For users with many people it could show the wrong raw text in the collapsible.

### Processing status banner on profile page is approximate
The profile page shows "Extracting facts…" based on `sources.processing_status`. It checks the most recent source across all of the user's sources, not just sources for this person. Same root cause as above — acceptable for V1.

### No polling on the profile page
Step 34 adds polling (GET /api/people/[id]/status). The current profile page is a server component that renders once. After submission, the user lands on the profile and sees "Processing…" — but they must manually refresh to see extracted facts. Step 34 wires up the polling client component.

---

## 5. Next Step: Step 32 — Inngest Embed Job

**File to create:** `src/inngest/functions/embed.ts`

**Triggered by:** `vault/facts.extracted` event (data: `{ source_id, user_id }`)

**What it must do:**
1. Fetch all `fact` rows for the given `source_id` where `embedding IS NULL`
2. For each fact, call `embedText(fact.value)` from `src/lib/claude.ts`
3. Write the resulting vector to `facts.embedding` using a raw Prisma query (pgvector requires `$queryRaw` or `$executeRaw` — the `embedding` field is `Unsupported("vector(1536)")` in the schema and cannot be set via normal Prisma create/update)
4. After all facts are embedded, compute `shared_interest` edges: find other people in the vault with matching interest fact values and create `shared_interest` edges (status: `inferred`) — skip dedup check is already in Step 6 of the extract job
5. Update `sources.processing_status` to `'complete'` (it will already be `'complete'` from the extract job; this is a no-op safety update)
6. Register the function in `src/app/api/inngest/route.ts`

**Acceptance criteria:**
- After adding a person and waiting for both jobs to run, `facts.embedding` is populated (non-null) in Prisma Studio
- A pgvector similarity query returns results for that user
- The Inngest dashboard shows both `extract-person-facts` and `embed-person-facts` under Functions

**Critical implementation note on pgvector writes:**  
The `embedding` field is `Unsupported("vector(1536)")` in the Prisma schema. You cannot write it with `prisma.fact.update({ data: { embedding: [...] } })` — Prisma will error. Use raw SQL:
```typescript
await prisma.$executeRaw`
  UPDATE facts
  SET embedding = ${JSON.stringify(vector)}::vector
  WHERE id = ${factId}
`
```

---

## 6. New Environment Variables Added This Session

| Variable | Where needed | When needed |
|----------|-------------|-------------|
| `OPENAI_API_KEY` | `.env.local` and Vercel | Before Step 32 (embed job). `embedText()` in `src/lib/claude.ts` calls `openai.embedding('text-embedding-3-small')` and will throw without this key. |

All other environment variables (`DATABASE_URL`, `DIRECT_URL`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`) were already set before this session and remain unchanged.
