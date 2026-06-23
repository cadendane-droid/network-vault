# PostHog Instrumentation Plan — Almura

**Status:** Plan only. No instrumentation code is changed by this document. A
follow-up prompt will execute the sequenced steps below one at a time.

**Scope:** Audit of what PostHog captures today + a written implementation plan
for the 14 target metrics in the capture→query funnel.

**Environment note for verification steps:** the author works solo on Windows /
PowerShell. Shell snippets below use PowerShell-safe forms.

---

## 0. TL;DR — what the audit changed about the plan

Two assumptions in the brief are wrong in the code, and both *reduce* the work:

1. **App Router `$pageview` is already captured.**
   [`src/app/PostHogPageView.tsx`](../src/app/PostHogPageView.tsx) runs a
   `usePathname`/`useSearchParams` effect that fires `$pageview` on every soft
   navigation, mounted via the provider. This means metrics **#4, #5, #8, #9,
   #10, #12** are already feasible on `$pageview` with **no foundational fix
   required**. The taxonomy decision (explicit `*_page_opened` vs `$pageview`)
   is therefore a *real, available* choice today, not blocked work.

2. **The query UI does not use the Vercel AI SDK `useChat`.**
   [`src/components/chat.tsx`](../src/components/chat.tsx) is a hand-rolled
   `fetch` + `ReadableStream` reader with local `useState` messages. There is no
   `useChat` thread and no `conversation_id`. So metric **#14** cannot "add
   properties to a `useChat` thread" — it requires the client to mint a
   conversation id and turn index and pass them to `/api/query`, which then
   attaches them to the existing server-side `query_asked`.

A third reconciliation point: `person_added` fires **only when a net-new
`people` row is created**, while `source_submitted` fires on **every**
submission (including adding a note to an existing person). They are not
interchangeable and must not be summed in a single funnel step (see §2/§3).

---

## 0b. Resolved decisions & do-not-sum rules

This section records the decisions and findings locked in by **Step A
(page-open / session / transition metrics)** — the first of the four
instrumentation steps. Subsequent steps must treat these as settled.

### Resolved decisions

- **D1 — Taxonomy (RESOLVED → Option A):** Standardize page-open, session-time,
  and page-transition metrics (#4, #5, #8, #9, #10, #12) on **`$pageview`**.
  **Keep `graph_opened` and `profile_viewed`** as semantic markers — they carry
  properties a raw `$pageview` cannot (see findings below). **Do not add**
  `query_page_opened` or `people_page_opened`: #4/#5/#10 are fully covered by
  `$pageview` on `/query`, `/network`, and `/people`. Adding them would
  duplicate `$pageview` and create a double-count risk against #8/#9.
- **D4 — `capture_pageleave` (RESOLVED → enabled):** `capture_pageleave: true`
  is now set in the window-guarded client init
  ([`providers.tsx`](../src/app/providers.tsx)). `capture_pageview` stays
  `false`; the manual `$pageview` in
  [`PostHogPageView.tsx`](../src/app/PostHogPageView.tsx) remains the source of
  truth.

### Findings — `$pageview` payload & `$pageleave` on soft nav

- **`$pageview` now carries `pathname` and `previous_pathname`.** The manual
  capture already sent `$current_url`; it now also sends an explicit `pathname`
  (ids-only route path, e.g. `/people/<id>`) and a `previous_pathname`
  (the prior pageview's pathname, `null` on the first pageview of a session).
  This makes page-to-page transition counts (#9) reconstructable from a single
  event without URL parsing. **No PII** — pathnames carry ids, never names.
- **`$pageleave` does NOT fire on App Router soft navigations** with this setup.
  Installed **posthog-js `1.386.4`**. With manual pageviews
  (`capture_pageview: false`), posthog-js emits `$pageleave` only from the real
  page-hide / unload path (tab close, hard navigation, backgrounding) — it does
  **not** emit a `$pageleave` when the App Router changes routes client-side.
  This is expected for this version and was **not** worked around. Consequence:
  whole-**session** duration is still captured via the unload `$pageleave`, but
  **per-page dwell across soft nav** must be reconstructed from consecutive
  `$pageview` timestamps + `previous_pathname`, not from `$pageleave`.

### Findings — `profile_viewed` & `graph_opened` properties

- **`profile_viewed`** previously carried **only `person_id`**. Because a raw
  `$pageview` on `/people/[id]` already encodes the id in its pathname,
  `person_id` alone did not make the event meaningfully distinct. Per D1 it now
  also carries **`fact_count`** (count of raw + confirmed facts) and
  **`has_confirmed_facts`** (boolean), derived server-side in
  [`people/[id]/page.tsx`](../src/app/(app)/people/[id]/page.tsx) and passed to
  [`track-profile-view.tsx`](../src/components/track-profile-view.tsx).
  Counts/booleans/ids only — **never the name**.
- **`graph_opened`** already carries **`node_count`** and **`edge_count`**
  ([`constellation.tsx:206`](../src/components/constellation.tsx)) — graph-level
  counts a `$pageview` on `/network` cannot provide. It is already distinct and
  was **left unchanged**.

### Do-not-sum rules

These event pairs overlap in surface but mean different things. **Never add the
two members of a pair into a single funnel/aggregate step.** Annotate the
corresponding dashboard insights (§7).

| Pair | Why they differ |
|---|---|
| `person_added` ≠ `source_submitted` | `person_added` fires only on a net-new `people` row; `source_submitted` fires on **every** submission (incl. adding a note to an existing person). A new person fires **both**. Use `person_added` for "people captured", `source_submitted` for "capture actions". |
| `graph_opened` ≠ `$pageview(/network)` | `graph_opened` fires once per Constellation mount **after graph data resolves** and carries `node_count`/`edge_count`; `$pageview(/network)` fires on navigation regardless of data load. Counting both inflates "graph opens". |
| `profile_viewed` ≠ `$pageview(/people/[id])` | `profile_viewed` is the explicit profile marker (carries `fact_count`/`has_confirmed_facts`); `$pageview(/people/[id])` is the raw navigation. They describe the same visit from two angles — pick one per metric, do not sum. |

---

## 1. Audit summary

### 1.1 PostHog initialization

| Aspect | State | Source |
|---|---|---|
| Client init | `posthog.init(...)` at **module scope, guarded by `typeof window !== 'undefined'`** | [`src/app/providers.tsx:9-15`](../src/app/providers.tsx) |
| Provider | `PostHogProvider` wraps the app in the root layout; renders `PostHogPageView` (in `<Suspense>`) + `PostHogIdentify` | [`providers.tsx:17-27`](../src/app/providers.tsx), [`layout.tsx:35`](../src/app/layout.tsx) |
| `person_profiles` | `'identified_only'` | `providers.tsx:12` |
| Automatic pageview | **`capture_pageview: false`** — disabled | `providers.tsx:13` |
| App Router `$pageview` | **Captured manually** on every soft navigation via `usePathname`/`useSearchParams` effect; sends `$current_url` incl. query string | [`PostHogPageView.tsx`](../src/app/PostHogPageView.tsx) |
| `autocapture` | **Not set → defaults to ON** (clicks/inputs/pageleave autocaptured) | `providers.tsx` (absent) |
| Session recording | **Not configured in code** (`disable_session_recording` not set → governed by the PostHog project setting). No explicit opt-in/opt-out in the bundle. | `providers.tsx` (absent) |
| Identify | On Clerk load, `posthog.identify(clerkUserId, { email, name })`; `reset()` on sign-out | [`PostHogIdentify.tsx`](../src/app/PostHogIdentify.tsx) |
| Distinct ID convention | **Clerk user id** everywhere. Server events look up `clerk_id` from the DB user to match. | `embed.ts:150-156`, `query/route.ts:113`, `people/route.ts:147` |
| Server client | `posthog-node` singleton; `captureServerEvent(distinctId, event, props)` uses `captureImmediate` and swallows errors | [`src/lib/posthog-server.ts`](../src/lib/posthog-server.ts) |
| **Build caveat (confirmed)** | `src/lib/posthog-server.ts` does `new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!)` at **module scope** — throws during `next build` when the key is absent (documented in `docs/handoff.md` §773-774). The client init is window-guarded and safe. **Any new server-side events must route through the existing `captureServerEvent` helper — do not add new module-scope PostHog construction.** |

> ⚠️ **PII note on identify:** `PostHogIdentify` sends `email` and `name` as
> person properties. That is the user's own identity (standard PostHog practice),
> not third-party contact PII, so it is acceptable — but it means person
> profiles contain email. No event below should add any *contact* PII.

### 1.2 Existing events

| Event | Trigger location | Trigger semantics | Client/Server | Properties | PII? |
|---|---|---|---|---|---|
| `$pageview` | [`PostHogPageView.tsx:17`](../src/app/PostHogPageView.tsx) | Fires on initial load **and every soft navigation** (pathname/searchParams change) | Client | `$current_url` (origin + pathname + querystring) | ⚠️ URL may contain `?new=<personId>` (an id, not PII — acceptable). No names. |
| `person_added` | [`api/people/route.ts:147`](../src/app/api/people/route.ts) | Fires **only when a brand-new `people` row is created** (inside the `else` branch of the existing-person check). Adding a source to an existing person does **not** fire it. | Server | `person_id`, `source_kind` | No (ids/enums) |
| `source_submitted` | [`api/people/route.ts:177`](../src/app/api/people/route.ts) | Fires on **every** successful submission after the row(s) are written + Inngest enqueued, just before the 201 response. New or existing person. | Server | `person_id`, `source_id` | No (ids) |
| `processing_completed` | [`inngest/functions/embed.ts:150-167`](../src/inngest/functions/embed.ts) | Fires after extraction **and** embedding succeed and `processing_status='complete'` is written (the true end of the pipeline). | Server (Inngest step) | `person_id`, `source_id`, `facts_count`, `edges_count`, `embedded`, `shared_interests_count` | No (ids/counts/bools) |
| `query_asked` | [`api/query/route.ts:113`](../src/app/api/query/route.ts) | Fires after all rate-limit gates pass and the vault context is non-empty, immediately before the Anthropic stream starts. | Server | `results_count` (fact count in context) | No (count). **Query text is NOT sent — good.** |
| `graph_opened` | [`components/constellation.tsx:206`](../src/components/constellation.tsx) | Fires inside the `/api/graph` fetch `.then()` — i.e. once per Constellation mount, after graph data resolves. Effectively "graph page loaded with data". | Client | `node_count`, `edge_count` | No (counts) |
| `profile_viewed` | [`components/track-profile-view.tsx:12`](../src/components/track-profile-view.tsx) | Fires on mount of `TrackProfileView`, rendered by the person profile **page** (`/people/[id]`). Does **not** fire on the constellation node preview. | Client | `person_id` | No (id) |

**Behavioral facts that matter for the plan:**

- The constellation **node preview bottom-sheet** (#6) is shown by
  `setSelectedNode(n)` in `onNodeClick`, which runs **only when no `onNodeClick`
  prop is passed** ([`constellation.tsx:600-607`](../src/components/constellation.tsx)).
  The `/network` page renders `<Constellation>` **without** `onNodeClick`
  ([`network/page.tsx:161`](../src/app/(app)/network/page.tsx)), so the live path
  is the bottom sheet. **No event fires on node click today.**
- **Search is client-only**, a synchronous `.filter()` in
  [`people-list-with-search.tsx:19-21`](../src/components/people-list-with-search.tsx).
  No debounce, no network call, **no event**.
- **User provisioning** was originally two blind `prisma.user.upsert` calls (app
  shell + `/api/user`) that couldn't distinguish create from returning. **Step C
  collapsed both into one util** ([`src/lib/provisionUser.ts`](../src/lib/provisionUser.ts))
  doing find-or-create, with `account_created` emitted on the create branch only
  (race-safe). See §3 #1.
- The add-person flow's `submit` moment (t=0) is in
  [`add-person-form.tsx:28-35`](../src/components/add-person-form.tsx);
  `capture.start(...)` hands the in-flight POST promise to `CaptureProvider`,
  which owns the float animation and the `router.push('/network?new=<id>')`
  ([`capture-animation.tsx:122-204`](../src/components/capture-animation.tsx)).
  `CaptureProvider` lives in `(app)/layout.tsx`, so it **survives** the
  `/people/new → /network` route change — the correct home for the #13 timer.

---

## 2. Coverage matrix (all 14 target metrics)

| # | Metric | Status | Final event name | Notes |
|---|---|---|---|---|
| 1 | Sign up / account creation | **Implemented** | `account_created` | Server, emitted on the create branch of the single `provisionUser` util; race-safe; auth-provider only. |
| 2 | Adding a person (submit / intent, t=0) | **New** (not covered; `source_submitted` is post-persist) | `person_submitted` | Client, fired at tap before the POST. |
| 3 | Person saved to vault (persisted, 201) | **Covered** | `source_submitted` (all submits) + `person_added` (net-new only) | Keep both; do not sum. See §3. |
| 4 | Click query page | **Covered** by `$pageview` (`/query`) | `$pageview` (recommended) | No new event under the recommended taxonomy. |
| 5 | Click graph page | **Covered** by `graph_opened` (and `$pageview` `/network`) | `graph_opened` (keep) | Verify it fires on every `/network` open. |
| 6 | Click node → limited info (bottom sheet) | **New** | `node_preview_opened` | Client, in constellation `onNodeClick`. No name. |
| 7 | Feedback open + submit | **New** (two events) | `feedback_opened`, `feedback_submitted` | Metadata only; never the message body. |
| 8 | Time spent per session | **Covered** by PostHog session duration (pageviews exist) | *(no event)* `$pageview` + `$pageleave` | See §6 decision; lowest-code = enable on existing config. |
| 9 | Page-transition count | **Covered** by `$pageview` | *(no event)* `$pageview` | Count pageviews per session; `from`/`to` derivable. |
| 10 | Click people page | **Covered** by `$pageview` (`/people`) | `$pageview` (recommended) | No new event under recommended taxonomy. |
| 11 | Search bar usage | **New** | `people_search_performed` | Debounced (`SEARCH_DEBOUNCE_MS`); `query_length`/`result_count` only, never text. |
| 12 | Click into a person's profile | **Covered** by `profile_viewed` | `profile_viewed` (keep) | Verify fires on `/people/[id]`, not on node preview. |
| 13 | Load time submit → node populated | **Implemented** | `person_capture_timing` | Single event; `ms_to_post_response` / `ms_to_node_visible` (headline) / `ms_to_processing_complete` (nullable) + `person_id`, from `CaptureProvider`. |
| 14 | Repeat queries in a conversation | **Implemented** | `query_asked` (+ `conversation_id`, `turn_index`) | Client mints uuid + 1-based index (no `useChat`); route attaches. |

---

## 3. Per-event spec (new + modified events)

### #1 — `account_created` *(IMPLEMENTED — Step C, server)*

- **Layout is a server component.** [`(app)/layout.tsx`](../src/app/(app)/layout.tsx)
  is an `async` server component on the universal authenticated entry path
  (`await auth()` / `currentUser()`, no `'use client'`), so the provisioning
  util runs there directly — `account_created` is tied to the real DB create and
  never to a client render.
- **Single provisioning path (D3):** both the blind `prisma.user.upsert` calls —
  in [`(app)/layout.tsx`](../src/app/(app)/layout.tsx) and
  [`api/user/route.ts`](../src/app/api/user/route.ts) — were replaced by one
  util, [`src/lib/provisionUser.ts`](../src/lib/provisionUser.ts). It does
  `findUnique(clerk_id)` → if null, `create` the row and emit `account_created`
  via `captureServerEvent` **on the create branch only**. There is now exactly
  one provisioning code path.
- **Race-safe:** if a concurrent provision wins the insert and our `create`
  throws the unique-constraint error (`Prisma…P2002`), the util re-reads the row
  and returns it **without** emitting `account_created`. A returning/duplicate
  request can never produce a spurious sign-up event.
- **Client/Server:** Server, via `captureServerEvent(clerkId, 'account_created', …)`.
- **Distinguish sign-up from sign-in:** sign-in does **not** create a row, so the
  create-gated event is inherently sign-up only.
- **Properties (as shipped):**
  | prop | type | notes |
  |---|---|---|
  | `auth_provider` | string \| *(absent)* | categorical sign-up method derived from Clerk's `currentUser()` — first `externalAccounts[].provider` (e.g. `'google'`), else `'email'` when `passwordEnabled`, else the property is **omitted**. Provider *name* only — never `providerUserId` or email. |
- **PII:** none. (Per D3 the event carries the auth-provider enum or nothing —
  no `plan`, no identifiers.)

### #2 — `person_submitted` *(new, client)*

- **Trigger:** [`add-person-form.tsx`](../src/components/add-person-form.tsx)
  `handleSubmit`, **after `e.preventDefault()` and before/at `capture.start(...)`**
  — the true t=0 intent moment, before the POST resolves.
  - Alternative home: `CaptureProvider.start()` (so timing #13 and this event
    share one t=0). Recommended to fire it from `start()` to guarantee a single
    consistent t=0 timestamp shared with `person_capture_timing`.
- **Client/Server:** Client (`usePostHog().capture`).
- **Properties:**
  | prop | type | notes |
  |---|---|---|
  | `name_length` | number | `name.trim().length` — never the name |
  | `note_length` | number | `rawText.trim().length` — never the text |
- **PII:** none (lengths only).
- **Double-count caution:** this is the **submit** step; `source_submitted` is
  the **persisted** step. In the funnel they are distinct stages, not duplicates.

### #3 — `source_submitted` / `person_added` *(RECONCILED — Step C, no code change)*

- **Verified against the three-moment model** in
  [`api/people/route.ts`](../src/app/api/people/route.ts). The events are
  already correctly gated and **do not conflate or double-fire**:
  - **submit (persisted, 201):** `source_submitted` fires on **every** successful
    submission, just before the 201 — new *or* existing person (route line ~177).
  - **net-new person:** `person_added` fires **only** inside the `else`
    (no-existing-person) branch (route line ~147), so adding a source to an
    existing person fires `source_submitted` **only**, with no second
    `person_added`.
  - **extraction complete:** `processing_completed` fires later, from the Inngest
    pipeline, at the true end of extraction+embedding.
- **Outcome:** no fix required — the three moments are already distinct. New
  person → `person_added` **and** `source_submitted`; existing person →
  `source_submitted` only.
- **Funnel rule (unchanged):** for "people captured" use **`person_added`**; for
  "capture actions" use **`source_submitted`**. **Never sum them** — a new person
  fires both (see the do-not-sum table in §0b).

### #6 — `node_preview_opened` *(IMPLEMENTED — Step B, client)*

- **Trigger:** [`constellation.tsx`](../src/components/constellation.tsx),
  inside `onNodeClick`, in the `else` branch where `setSelectedNode(n)` runs (the
  limited-info bottom-sheet preview). Fires alongside `setSelectedNode` via
  `posthog?.capture(...)`. **Not** fired on the `onNodeClick`-prop path or on
  navigation to the full profile (`profile_viewed` covers that).
- **Client/Server:** Client (`usePostHog().capture`, optional-chained guard).
- **Properties (as shipped):**
  | prop | type | notes |
  |---|---|---|
  | `person_id` | string | `n.id` — id, not a name |
  | `has_confirmed_facts` | boolean | from `n.hasConfirmedFacts` |
  | `fact_count` | number | from `n.factCount` |
- **PII:** none. **`n.name` is NOT sent.**
- **Distinction from #12:** this is the preview; `profile_viewed` is the full
  profile navigation. Different funnel steps. Both carry `person_id` so
  preview→profile conversion is joinable.

### #7 — `feedback_opened` + `feedback_submitted` *(IMPLEMENTED — Step B)*

- **`feedback_opened` (client):** fired in the pill `onClick` in
  [`feedback-button.tsx`](../src/components/feedback-button.tsx) alongside
  `setOpen(true)`, via `usePostHog().capture`. Property: `page: 'network'`.
- **`feedback_submitted` (server):** submit posts to `/api/feedback`, so this is
  emitted **server-side** in
  [`api/feedback/route.ts`](../src/app/api/feedback/route.ts) via
  `captureServerEvent(user.clerkId, 'feedback_submitted', …)` immediately after
  the row is written and **before** the 201 — i.e. on success only. (Routing it
  through the existing helper avoids module-scope PostHog and keeps the body off
  the wire.)
- **Properties (`feedback_submitted`, as shipped):**
  | prop | type | notes |
  |---|---|---|
  | `message_length` | number | `message.trim().length` — never the body |
  | `page` | string \| `null` | normalized from the request body (currently `'network'`) |
- **No rating:** the feedback form is a single textarea with no rating control,
  so no `rating` property is sent.
- **PII:** none. **The message body is never sent** (mirrors the route's
  existing "never log the body" rule).

### #11 — `people_search_performed` *(IMPLEMENTED — Step B, client)*

- **Trigger:** [`people-list-with-search.tsx`](../src/components/people-list-with-search.tsx).
  A **debounced** `useEffect` keyed on `query` (and `people`) fires once per
  settled, non-empty search — **not per keystroke**. The debounce window is the
  named constant **`SEARCH_DEBOUNCE_MS` (default `350`)** at the top of the
  component. Empty / whitespace-only queries are suppressed (`trimmed === ''`
  early-returns). The existing synchronous `filtered` derivation is unchanged —
  only the analytics effect was added.
- **Client/Server:** Client (`usePostHog().capture`, optional-chained guard).
- **Properties (as shipped):**
  | prop | type | notes |
  |---|---|---|
  | `query_length` | number | `query.trim().length` |
  | `result_count` | number | recomputed in the effect with the same filter predicate as `filtered`, so it equals the rendered match count |
- **PII:** none. **The raw query string is never sent** (it contains contact
  names).

### #13 — `person_capture_timing` *(IMPLEMENTED — Step D, client)*

- **Home:** [`CaptureProvider`](../src/components/capture-animation.tsx). It
  lives in `(app)/layout.tsx` and survives the `/people/new → /network` route
  change, so a single timer spans the whole flow. Client timing stays inside the
  window guard.
- **Single event, three numeric ms deltas + `person_id`** (as shipped):
  | prop | type | endpoint | source of the timestamp |
  |---|---|---|---|
  | `ms_to_post_response` | number | submit → POST `/api/people` resolves | `start()` t0 → `personIdPromise.then` |
  | `ms_to_node_visible` | number | submit → optimistic node **actually mounts on the canvas** | `start()` t0 → constellation `markNodeVisible` (**headline metric**) |
  | `ms_to_processing_complete` | number \| `null` | submit → processing reaches `'complete'` | `start()` t0 → constellation `markProcessingComplete('complete')`; **null** on failure / safety-deadline (**activation-latency metric**) |
  | `person_id` | string | — | the resolved person id |
- **t0 definition:** `performance.now()` at the **top of `start()`** — the
  instant the POST fires. Stored in a ref.
- **node-visible hook (the important one):** `ms_to_node_visible` is driven by
  the **real canvas mount**, never the overlay animation. The constellation
  fires `markNodeVisible(newPersonId)` (on the next animation frame) once the
  graph has loaded (`!loading`, sized) **and** the new node is present in the
  graph data — i.e. ForceGraph2D is drawing it. This is a **single code path
  shared by both motion modes** (reduced motion only changes the overlay/edge
  animation, not the canvas node mount), so node-visible reflects true
  time-to-canvas under device latency in both paths. Using the animation
  `'arrived'` phase here would have hard-coded the float duration and corrupted
  exactly the device-latency number we want.
- **Decision — nullable single event (NOT a follow-up):** the event is emitted
  **once**, only after **both** node-visible **and** a terminal processing signal
  are in. `markProcessingComplete` (the client mirror of server-side
  `processing_completed`, observed via the constellation's existing status poll)
  flushes it with all three deltas populated. Two safety paths flush it with
  `ms_to_processing_complete = null` so the **headline is never lost**: a
  `'failed'` status, or a `TIMING_SAFETY_MS` (60 s) deadline armed at
  node-visible (covers the user leaving `/network` before extraction finishes,
  which stops the poll). **Why nullable over a follow-up:** a single row keeps
  all three deltas legible in **one insight** with no event-join; a second
  `*_extracted` event would split the activation-latency across two events. In
  the rare null case, the activation latency is still recoverable from the
  server-side `source_submitted` → `processing_completed` gap on `person_id`.
- **PII:** none (durations + id).

### #14 — `query_asked` + conversation context *(IMPLEMENTED — Step D)*

- **Reality:** no `useChat`. [`chat.tsx`](../src/components/chat.tsx) holds
  messages in local state and POSTs each turn to `/api/query`.
- **Implementation (as shipped):**
  1. In `chat.tsx`, a `conversationIdRef` is lazily minted with
     `crypto.randomUUID()` on the first accepted submit, and a `turnIndexRef`
     (1-based) is incremented per accepted submit. Both are sent in the POST body.
  2. In [`api/query/route.ts`](../src/app/api/query/route.ts), the route reads
     `conversation_id` / `turn_index` from the body (type-guarded) and attaches
     them to the **existing** server-side `query_asked` capture.
- **`conversation_id` lifecycle:** **one conversation = one mounted `Chat`
  thread.** The id is stable for the life of that mounted thread; navigating to
  `/query` afresh (a remount) mints a **new** `conversation_id` and resets
  `turn_index` to 1. There is no in-place "clear thread" control today, so the
  remount boundary *is* the conversation boundary.
- **Added properties on `query_asked`:**
  | prop | type | notes |
  |---|---|---|
  | `conversation_id` | string (uuid) | stable per mounted chat thread |
  | `turn_index` | number | 1-based, per accepted submit |
  - (existing `results_count` unchanged.)
- **Definition:** "repeat query" = any `query_asked` with `turn_index >= 2`.
  **No separate event.**
- **PII:** none. **Query text remains un-sent** — only the uuid + index.

---

## 4. The three-timestamp diagram (add-person flow)

```
 t0 SUBMIT                 t1 PERSISTED              t2 NODE VISIBLE        t3 EXTRACTED
 (POST fires, client)      (201 from POST)          (optimistic node)      (pipeline done)
     │                          │                         │                      │
     │  add-person-form         │  api/people/route.ts    │  constellation       │  inngest/embed.ts
     │  handleSubmit /          │  - writes people/source │  REAL canvas mount   │  mark-complete +
     │  CaptureProvider.start() │  - enqueues Inngest      │  (markNodeVisible,   │  status='complete'
     │                          │  - returns {person_id}   │  both motion paths)  │
     ▼                          ▼                         ▼                      ▼
                          ┌───────────────┐                                ┌──────────────────────┐
                          │source_submitted│  (every submit, server)       │processing_completed  │
                          │person_added    │  (net-new only, server)       │(server, Inngest)     │
                          └───────────────┘                                └──────────────────────┘
                                                                                  ▲
     └──────────────── person_capture_timing (client, CaptureProvider) ──────────┘
            ms_to_post_response = t1 − t0
            ms_to_node_visible  = t2 − t0   (headline)
            ms_to_processing_complete = t3 − t0   (null on failure / safety-deadline)
```

> Note: `person_submitted` (#2, the client t=0 *intent* event) remains planned,
> not built — it is outside the four implemented steps. `person_capture_timing`
> already stamps t0 at the same instant if it is added later.

- **Three distinct moments, three event groups:** submit (`person_submitted`),
  persisted (`source_submitted` / `person_added`), extracted
  (`processing_completed`).
- **`person_capture_timing`** is the *latency* lens spanning t0→t2 (and t0→t3
  when available). `processing_completed` remains the *pipeline-internal*
  duration/quality lens (facts/edges counts). They are complementary, not
  redundant: `processing_completed` measures the job; `person_capture_timing`
  measures the user-perceived wait from tapping submit.

---

## 5. Foundational tasks (do first)

1. **None blocking.** The usual App Router `$pageview` fix is **already in place**
   ([`PostHogPageView.tsx`](../src/app/PostHogPageView.tsx)). Verify only (see
   §8 step 0).
2. **Confirm session capture config** before relying on #8/#9: decide whether to
   add `capture_pageleave: true` (improves session-duration accuracy) in
   `providers.tsx`, and confirm the project-level session-recording setting is
   intentional. Keep all changes inside the **window-guarded** client init; do
   **not** touch the server module-scope pattern (build caveat).
3. **Pick the single `account_created` owner** (layout vs `/api/user`) before
   implementing #1, so the event can't double-fire.

---

## 6. Decision points (need sign-off before implementation)

### D1 — Taxonomy: explicit `*_page_opened` events vs `$pageview`

> **RESOLVED → Option A** (see §0b). `graph_opened`/`profile_viewed` kept;
> `query_page_opened`/`people_page_opened` not added.

- **Context:** `graph_opened` and `profile_viewed` are explicit page events;
  `$pageview` already fires on all navigations. Metrics #4, #5, #8, #9, #10, #12
  are all derivable from `$pageview` today.
- **Option A — Standardize on `$pageview`.** Use `$pageview` (filtered by
  `$current_url` / pathname) for page-open, transition-count, and session-time
  metrics. Keep `graph_opened`/`profile_viewed` *only* where they carry extra
  properties (`node_count`, `fact_count`) that `$pageview` can't.
  - ➕ #8, #9, #4, #10 for free; no new event sprawl; consistent.
  - ➖ Funnels mixing custom + `$pageview` steps read slightly less uniformly;
    relies on stable URL patterns.
- **Option B — Add explicit `query_page_opened`, `people_page_opened`, …** to
  match `graph_opened`.
  - ➕ Uniform custom-event funnels.
  - ➖ Duplicates `$pageview`; **double-count risk** with #8/#9; more code/maintenance.
- **Recommendation: Option A.** Standardize on `$pageview` for #4/#8/#9/#10,
  **keep `graph_opened` and `profile_viewed`** as-is (they carry useful props and
  already exist), and **do not** add `query_page_opened`/`people_page_opened`.
  This gets the most metrics with the least new code and avoids double-counting.

### D2 — Extraction endpoint for #13 (t0→t3)

> **RESOLVED** (see §3 #13). One `person_capture_timing` event with three deltas;
> headline = `ms_to_node_visible` (hooked to the **real** canvas mount in both
> motion paths). t0→t3 (`ms_to_processing_complete`) is carried on the **same**
> event — populated when the constellation observes `'complete'`, else `null` on
> failure / the 60 s safety-deadline. Nullable single event was chosen over a
> follow-up so all three deltas stay legible in one insight (no event-join).

- **Recommendation:** ship `person_capture_timing` with t0→t1 and t0→t2 now;
  add the `sessionStorage` hand-off in the constellation completion transition
  for t0→t3 as a fast follow (§3 #13, option 1). Sign off on whether t0→t3 is
  required for v1 or can be reconstructed in-PostHog by joining `person_submitted`
  + `processing_completed` on `person_id`.

### D3 — `account_created` owner (layout vs `/api/user`)

> **RESOLVED → single util** (see §3 #1). Both provisioning paths now delegate to
> [`src/lib/provisionUser.ts`](../src/lib/provisionUser.ts) (find-or-create,
> race-safe). `account_created` fires once on the real create regardless of which
> entry point provisions first, so there is no "owner" to pick and no double-fire.

- **Recommendation:** fire from `(app)/layout.tsx` (universal entry), make
  `/api/user` a no-event idempotent upsert. Confirm there is no flow that creates
  a user *only* via `/api/user` before the layout runs.

### D4 — `capture_pageleave` for session accuracy (#8)

> **RESOLVED → enabled** (see §0b). Note: on posthog-js `1.386.4` with manual
> pageviews, `$pageleave` fires on unload only, **not** on App Router soft nav.

- **Recommendation:** enable `capture_pageleave: true` in the client init for
  cleaner session-duration math. Sign off since it slightly changes event volume.

---

## 7. Suggested dashboard / funnel updates — "Almura User Workflow" (id 1700240)

*Recommendations only; no dashboard changes in this task.*

1. **Core activation funnel (rebuild around the thesis):**
   `account_created` → `person_submitted` → `source_submitted` (persisted) →
   `processing_completed` → `query_asked`. This makes the capture→query gap (the
   #1 diagnostic) explicit, and separates *submit* from *persisted* so a drop at
   the POST boundary is visible.
2. **Capture→query gap insight:** time-to-convert from first `person_added` to
   first `query_asked` per user (the core "capture is habit, retrieval is payoff"
   metric). Add a trends insight on the share of users who ever reach
   `query_asked`.
3. **Latency view (new):** `person_capture_timing` — p50/p90 of
   `t_submit_to_response_ms`, `t_submit_to_node_visible_ms`,
   `t_submit_to_extracted_ms`. Cross-reference with the historical
   `source_submitted` vs `processing_completed` gap.
4. **Repeat-query insight:** `query_asked` broken down by `turn_index`; define
   "conversations with follow-ups" = sessions with any `turn_index >= 2`.
5. **Engagement surface usage:** `node_preview_opened` vs `profile_viewed`
   (preview→profile conversion), `people_searched` frequency, `feedback_opened`
   → `feedback_submitted` completion rate.
6. **Session metrics (Option A):** session duration + pageviews-per-session from
   `$pageview`(+`$pageleave`). Annotate `person_added` vs `source_submitted`
   insight descriptions with the **do-not-sum** rule.

---

## 8. Sequenced implementation steps (each independently verifiable)

> Each step is small and shippable on its own. PowerShell verification snippets
> assume the dev server is running and `NEXT_PUBLIC_POSTHOG_KEY` is set locally.
> General verification: PostHog → Activity (live events), filtered to your
> distinct id; confirm props and **absence of PII**.

**Step 0 — Verify the existing baseline (no code).**
- Navigate between `/people`, `/query`, `/network` in the app.
- Verify: `$pageview` fires per navigation; `graph_opened` on `/network`;
  `profile_viewed` on `/people/[id]`. Confirm `$current_url` carries no names.
- ✅ Confirms the taxonomy decision (D1) is unblocked.

**Step 1 — D-decisions sign-off.** Resolve D1–D4 with the owner. Gate the rest.

**Step 2 — `account_created` (#1).** Implement create-detection in
`(app)/layout.tsx`; fire via `captureServerEvent`. Neutralize the `/api/user`
duplicate.
- Verify: sign up a fresh test account → exactly one `account_created`. Sign out
  and back in → **none**. (`Measure-Command` not needed; check PostHog Activity.)

**Step 3 — `query_asked` conversation props (#14).** Add `conversation_id` +
`turn_index` in `chat.tsx`; thread through the POST body; attach in
`api/query/route.ts`.
- Verify: ask two questions in one sitting → two `query_asked`, same
  `conversation_id`, `turn_index` 1 then 2. Reload `/query`, ask again → new
  `conversation_id`, `turn_index` 1. No query text present.

**Step 4 — `node_preview_opened` (#6).** Fire in constellation `onNodeClick`
(`else` branch).
- Verify: tap a node on `/network` → event with `person_id`,
  `has_confirmed_facts`, `fact_count`; **no `name`**. Tapping does not fire
  `profile_viewed`; tapping "View profile" does.

**Step 5 — Feedback events (#7).** `feedback_opened` on pill click;
`feedback_submitted` on success.
- Verify: open the feedback sheet → `feedback_opened`. Submit → `feedback_submitted`
  with `message_length`, `page`; **no `message`**.

**Step 6 — `people_searched` (#11).** Debounced effect in
`people-list-with-search.tsx`.
- Verify: type a multi-character query, pause → exactly one event after debounce
  with `query_length` + `result_count`; **no raw text**. Rapid typing does not
  fire per keystroke.

**Step 7 — `person_submitted` (#2) + t0 in `CaptureProvider`.** Fire at the top
of `CaptureProvider.start()` and stamp t0.
- Verify: add a person → `person_submitted` with `name_length`, `note_length`;
  **no name/notes**. Fires before `source_submitted`.

**Step 8 — `person_capture_timing` (#13a/b).** Emit t0→t1 and t0→t2 from
`CaptureProvider`.
- Verify: add a person → one `person_capture_timing` with positive
  `t_submit_to_response_ms` and `t_submit_to_node_visible_ms`, `reduced_motion`
  boolean. Cross-check ordering against the network tab POST timing.

**Step 9 — `person_capture_timing` t0→t3 hand-off (#13c, optional per D2).**
sessionStorage t0 → read on constellation completion → fire
`t_submit_to_extracted_ms`.
- Verify: add a person, wait for the node to finish processing → the extracted
  duration is populated (> node-visible duration) and only fires once.

**Step 10 — Session config (#8, per D4).** Add `capture_pageleave: true` in the
window-guarded client init; do **not** alter server module scope.
- Verify: `next build` still succeeds with the key **unset** locally (build
  caveat unbroken): `Remove-Item Env:NEXT_PUBLIC_POSTHOG_KEY; npm run build`.
  Confirm `$pageleave` appears in PostHog and session duration populates.

**Step 11 — Dashboard updates (§7).** Apply the funnel/insight recommendations on
dashboard 1700240. Manual, in the PostHog UI.

---

## Appendix — file index

| Concern | File |
|---|---|
| Client init / provider | `src/app/providers.tsx`, `src/app/layout.tsx` |
| `$pageview` | `src/app/PostHogPageView.tsx` |
| Identify | `src/app/PostHogIdentify.tsx` |
| Server capture helper (build caveat) | `src/lib/posthog-server.ts` |
| `person_added` / `source_submitted` | `src/app/api/people/route.ts` |
| `processing_completed` | `src/inngest/functions/embed.ts` |
| `query_asked` | `src/app/api/query/route.ts` |
| `graph_opened` / node preview (#6) | `src/components/constellation.tsx` |
| `profile_viewed` | `src/components/track-profile-view.tsx`, `src/app/(app)/people/[id]/page.tsx` |
| Add-person submit (#2) | `src/components/add-person-form.tsx` |
| Capture timer home (#13) | `src/components/capture-animation.tsx` (`CaptureProvider`) |
| Feedback (#7) | `src/components/feedback-button.tsx`, `src/app/api/feedback/route.ts` |
| Search (#11) | `src/components/people-list-with-search.tsx` |
| Query thread (#14) | `src/components/chat.tsx` |
| User provisioning (#1) | `src/app/(app)/layout.tsx`, `src/app/api/user/route.ts` |
</content>
</invoke>
