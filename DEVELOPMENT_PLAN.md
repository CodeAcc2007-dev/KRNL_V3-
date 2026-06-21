# KRNL V3 — Development Plan (to Deployment)

_Last updated: 2026-06-21_

---

## 📍 SESSION PROGRESS LOG (read this first on resume)

### ✅ Phase 0 — DONE & verified (NOT yet committed; working tree only)
- **Ask KRNL fixed** — `backend/app/services/retrieval.py`:
  - `qdrant_client.search()` → `query_points(...).points` (installed client removed `.search()`).
  - `text_search("full_body", query, config="english")` → `text_search("full_body", query, options={"config": "english"})`.
  - Verified end-to-end: retrieval returns 5 docs, Gemini answers with citations.
- **Sync Now button** — `frontend/src/app/components/InboxScreen.tsx`: replaced the dead
  hamburger with a real sync button (spinner, polls `/sync/status`, refreshes list, toast).
- **Dev sync fallback capped** — `run_email_sync` got a `max_emails` param
  (`backend/app/tasks/sync_task.py`); the synchronous fallback in
  `backend/app/api/v1/endpoints/sync.py` passes `3` so no-Redis runs return fast.
- **Removed hardcoded Ask KRNL mock Q&A** — `frontend/src/app/components/AskKrnlScreen.tsx`
  now opens with a real welcome message (no fake citations).
- **Importance-scale bug fixed** (earlier) — removed the broken `importance_score >= 0.7`
  check in `InboxScreen.tsx` (scores are now 0–100; rely on `personalized_priority`).

### ✅ Extra fixes this session
- **Collapsible "Full Message"** in `EmailDetailScreen.tsx` — collapsed by default,
  chevron toggle, animated expand. (Sits between AI Summary and Register Now.)
- **Service worker is now PROD-only** — `frontend/src/main.tsx`. In dev it unregisters any
  existing SW and clears caches. The old `public/sw.js` used stale-while-revalidate and was
  serving old code across reloads (cost a long debugging detour — don't re-enable SW in dev).

### 🔧 Files changed this session (all UNCOMMITTED on `main`)
- backend: `services/retrieval.py`, `tasks/sync_task.py`, `api/v1/endpoints/sync.py`
- frontend: `components/InboxScreen.tsx`, `components/AskKrnlScreen.tsx`,
  `components/EmailDetailScreen.tsx`, `main.tsx`
- `DEVELOPMENT_PLAN.md`
- (Also pre-existing uncommitted: `core/security.py` service-role switch, `ingestion.py`
  embedding model change, `App.tsx`/`LoginScreen.tsx` oauth-error handling, `SettingsScreen.tsx`
  connected-accounts UI — these predate this session.)
- ➡️ **Next: commit Phase 0 on a branch** before starting Phase 1.

### 🐞 NEW open issues found at end of session
1. **Duplicates from re-sync (urgent → Phase 1).** Re-syncing created duplicate event rows.
   Current DB state: **17 rows**, with `Internship Preparation` ×3, `SSoC 2026` ×3,
   `IPR Open House` ×2, `EnPoWER` ×2. Confirms dedup is needed NOW. Phase 1 must also include
   a **one-time cleanup** of existing duplicates + their orphaned Qdrant vectors.
2. **"Full Message" shows on only 1 email (INVESTIGATE).** User reports the collapsible body
   appears on just one mail. But the DB shows **every** event row has `full_body` (443–4510
   chars). So the detail view is likely falling back to `previewData` (which has no
   `full_body`) when the `GET /events/{id}` fetch is slow/failing — check the fetch path in
   `EmailDetailScreen.tsx` and confirm `GET /events/{id}` returns `full_body` reliably.
   The collapsible code itself is correct; the data reaching it is the suspect.

---

This is the ordered, phase-wise plan to get KRNL from its current state to a smooth,
secure deployment. Phases 0, 1, and 1.5 are **host-independent** and can be done now,
before choosing a deploy platform.

---

## Context & Architecture Decisions

### The real bottleneck: the shared Gemini key
Every user's emails flow through **one** Gemini API key, so the architecture's main job
is to **serialize all AI calls globally** so concurrent users can't blow the rate limit.

- **Preferred design:** Celery + Redis with `worker_concurrency=1` used as a *deliberate
  global throttle*. One worker = one shared queue = one global Gemini pacer.
- **Why not FastAPI BackgroundTasks / per-request:** each request throttles itself, but N
  users syncing together = N× concurrent Gemini calls = instant 429s. Cannot enforce a
  global cross-user rate limit.
- **Scales smoothly:** free→paid Gemini = raise `worker_concurrency` / drop the sleep
  (config only). Adding Gmail sync = new `account_type`, same task/queue/throttle (no
  rewrite). More users = add a worker.

### Capacity math (current 13s/email throttle)
~15s/email × 15 emails ≈ **4 min/user**, serial. In a 3-hour window → **~45 user ceiling**
on free tier + single worker. 10–15 users now → ~40–60 min/cycle (comfortable). Headroom
to ~40 users before Gemini billing is required.

### Two dedup problems are DIFFERENT
| Problem | Trigger | Solution |
|---|---|---|
| Exact dup — same email re-fetched | re-sync | `message_id` dedup (Phase 1) |
| Semantic update — *new* "deadline extended" email about an *existing* event | follow-up mail | entity resolution (Phase 1.5) |

`message_id` will NOT catch the extension email — it's a different email with its own ID.

---

## Current Issues (diagnosed)

1. **Sync invisible / blocking** — no Redis → `/sync/trigger` falls back to synchronous
   `.apply()` in the request thread; 10 emails × 13s sleep ≈ 130s blocking → browser times
   out. Also fired silently on connect with no UI feedback.
2. **No deduplication** — `events` table has no `message_id`; incremental filter uses
   `date_gte` (date-only) → re-fetches & re-inserts same-day emails → duplicates + wasted
   Gemini quota.
3. **Embeddings called one-per-chunk** — wasted quota; API accepts a list.
4. **Deadline-extension events not recognized** — multiple extension emails create
   confusing duplicate events instead of updating the original.
5. **Ask KRNL / semantic search broken** — installed `qdrant-client` removed `.search()`
   (only `query_points()` exists); `retrieval.py` calls `.search()` → throws → caught →
   returns `[]` → "I couldn't find any relevant emails." (Data is fine: 8 events, 5
   vectors @ 768-dim.)
6. **`/sync/status/{task_id}` has no auth** (`get_sync_status` lacks `Depends(get_current_user)`).
7. **Importance scale bug (FIXED)** — `sync_task.py` now stores `importance_score` 0–100,
   but the inbox "Important" filter checked `>= 0.7`; removed the broken check.
8. **Audit leftovers** — Opportunities tab always empty; monotonous single-letter avatars;
   no load-more/pagination; hardcoded Ask KRNL mock messages; dead hamburger button;
   aggressive title truncation; hidden "Academic" tab.

---

## Phase 0 — Broken-now fixes + make sync visible *(hours, no host needed)*
Cheapest, highest-impact. Do first.
- 🔴 **Fix Ask KRNL**: `qdrant_client.search()` → `query_points()` in
  `backend/app/services/retrieval.py`. Restores semantic search instantly.
- **Sync Now button** in `frontend/src/app/components/InboxScreen.tsx` (replaces dead
  hamburger): spinner → poll `/sync/status` → refresh inbox.
- **Cap dev sync fallback to ~3 emails** so a no-Redis run returns in <40s.
- Trivial polish: remove hardcoded mock messages in Ask KRNL.

## Phase 1 — Quota & data integrity *(before letting the first 15 users in)*
- **`message_id` column + unique `(user_id, message_id)`** → idempotent re-syncs.
- Switch incremental fetch from `date_gte` to message_id-based skipping.
- **Batch embeddings** — one call per email instead of per-chunk.
- **Extraction emits `is_update` + `update_type`** (same Gemini call, richer schema).

## Phase 1.5 — Deadline-extension intelligence
- Signal-gated semantic merge (only on `is_update`), embedding-match against the user's
  *active* events; LLM-confirm the top candidate.
- `deadline_history jsonb` + **extend-forward-only** guard (only accept later deadlines).
- UI badge: "Deadline extended: Jun 10 → Jun 20".
- Keep merge logic behind review to validate `is_update` quality before trusting
  auto-mutation.

### Schema additions (fold into Phase 1 migration)
```
events: + message_id        text
        + deadline_history   jsonb default '[]'
        + last_update_type   text     -- optional, drives the UI badge
```

## Phase 2 — Background infra *(when picking a host)*
- Stand up **Redis (Upstash free)** + **Celery worker**; make async the real path,
  fallback = dev-only.
- Bonus: turns on the semantic cache → faster, cheaper Ask KRNL.

## Phase 3 — Auto-sync
- **Celery Beat task** enqueuing all `connected` accounts every 3–4h, 15-mail cap.
  (Pattern exists already: the hourly deletion task in `celery_app.py`.)

## Phase 4 — Security hardening *(gate before public deploy)*
- Auth on `/sync/status`; lock CORS to the real frontend origin; remove
  `TEMP_ACCESS_TOKEN`; `ENCRYPTION_KEY`/keys via host secrets (not committed);
  rate-limit `/sync/trigger`.

## Phase 5 — Remaining UX polish *(from earlier audit)*
- Opportunities tab (fix AI categorization or honest empty state), per-sender avatar
  colors, load-more/pagination, title truncation, hidden "Academic" tab.

---

## Why this order
- **Phase 0** fixes two features that are *dead right now* (search + visible sync) for
  almost no cost.
- **Phase 1** must land before real users — every duplicate email wastes Gemini quota you
  can't spare on free tier.
- **Phase 1.5** is the headline feature but depends on Phase 1's fields.
- **Phases 2–4** cluster around the deploy moment (need a host + secrets).
- **Phase 5** is pure polish, safe to trail.
