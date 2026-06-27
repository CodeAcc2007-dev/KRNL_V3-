# Ask KRNL — Reliability & Accuracy Tuning (Design)

_Date: 2026-06-28 · Branch: `redesign` · Resolves Issue A (tracker)_

## Problem

Ask KRNL gives unreliable, imprecise answers. Two distinct failures, both reported by
the user ("both equally"):

1. **Recall** — it misses events that plainly appear in the task/Deadlines view. The
   `/deadlines` endpoint returns *every* event with a deadline straight from the events
   table, but Ask KRNL instead runs semantic RAG capped at 5 documents, so events that
   don't textually match the query are never surfaced.
2. **Precision** — even for retrieved events, `query.py` builds the LLM context from only
   `display_name` + body chunk text, **dropping the structured `deadline`/`venue` fields**
   that `hybrid_retrieval` already returns. Answers are vague about exact dates/venues.

## Goal

Make Ask KRNL reliably enumerate the same events the task view shows, and state their
exact deadline/venue/links — without adding any extra Gemini/LLM round-trip (shared-key
free-tier constraint).

Chosen approach: **B — always attach the structured agenda + enriched RAG.** No intent
routing, no extra LLM call.

## Design

### 1. Unified, event-keyed source set (core)

Build **one numbered list of source events** from two merged inputs:

- **Agenda (recall):** query the events table for upcoming deadline events — the same
  source as the task view (`deadline >= today − grace_days`, sorted by deadline
  ascending). Compact per event: `display_name`, formatted deadline, `venue`, `category`.
  Bounded (cap ~25).
- **RAG (detail):** `hybrid_retrieval`, **deduped by `event_id`** so retrieval slots are
  not wasted on multiple chunks of the same email. Each contributes body text + the
  structured fields it already returns.

Merge by `event_id`: an event present in both gets its body text attached to its agenda
entry. Number the merged set `[1..M]`, agenda-first ordered by deadline, then RAG-only
extras. Result: every task-view event is visible to the model (recall) and every event
carries its exact date/venue/links (precision).

Bounds: agenda ≤ 25 events; RAG-only extras ≤ 5. Each source is compact (structured
fields always; body text only where RAG provided it).

### 2. `backend/app/services/retrieval.py`

- Dedupe vector results by `event_id` before RRF scoring/return (keep highest-ranked
  chunk per event).
- Add `get_upcoming_agenda(user_id, grace_days=1) -> list[dict]`: returns the compact
  structured upcoming-deadline list (reuse the `/deadlines` query shape — events with
  non-null deadline, filtered to `deadline_date >= today_ist − grace_days`, sorted
  ascending). Returns `event_id, display_name, deadline, venue, category`.

### 3. `backend/app/api/v1/endpoints/query.py`

- Replace the current context build. Construct the unified source set (agenda merged with
  deduped RAG), then render each numbered source with its structured block
  (deadline/venue/category/links) **plus** body text where available.
- Tighten the system prompt: answer only from provided events; for list/deadline
  questions **enumerate completely and never omit a listed deadline**; state exact dates
  and venues; cite each statement with `[n]`; never hallucinate links.
- Citation extraction maps `[n] → event_id` over the unified set, so agenda-only events
  (no RAG hit) are still citable — not just RAG documents as today.
- Empty-context fallback still applies only when both agenda and RAG are empty.

### 4. Citation rendering

The current superscript map only covers indices 1–5. Generate superscripts
programmatically for arbitrary `n` (or fall back to `[n]`) so indices beyond 5 render.
Confirm the frontend Ask KRNL renderer handles the chosen form before finalizing.

### 5. Cache invalidation

- Add `invalidate_user_cache(user_id)` to `semantic_cache.py`: delete all
  `cache:{user_id}:*` keys.
- Call it from `sync_task.run_email_sync` when `emails_processed > 0`, so a sync that
  ingests new events clears stale cached answers. Keep the existing 24h TTL as a backstop.

### 6. Testing (test-first, `backend/tests/`)

- vector results dedupe by `event_id` (highest rank kept).
- `get_upcoming_agenda` filters by grace window and sorts ascending.
- unified merge: event in both agenda and RAG appears once with body attached; numbering
  is agenda-first.
- citation mapping resolves an agenda-only event's `[n]` to its `event_id`.
- `invalidate_user_cache` deletes only the target user's keys.

## Out of scope

Intent routing (Approach C), re-chunking strategy, embedding-model changes, broader
prompt/persona redesign.

## Affected files

- `backend/app/services/retrieval.py`
- `backend/app/api/v1/endpoints/query.py`
- `backend/app/services/semantic_cache.py`
- `backend/app/tasks/sync_task.py`
- frontend Ask KRNL citation renderer (only if >5-index rendering needs a change)
- `backend/tests/` (new tests)
