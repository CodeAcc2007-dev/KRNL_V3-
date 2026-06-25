# Session — 2026-06-22 · Phase 1, dedup cleanup, deadline-extension planning

## What we did
- **Committed Phase 0** as a checkpoint on branch `phase-1-quota-data-integrity` (main kept
  as rollback point).
- **Phase 1 (test-first, 11 unit tests in `backend/tests/`):**
  - `app/utils/dedup.py::get_message_id` (RFC Message-ID, `uid:` fallback).
  - `sync_task` skips already-ingested `message_id`s; treats unique-violation as a no-op skip.
  - `ingestion.generate_embeddings_batch` — one Gemini call per email (blank → zero vector,
    index-aligned).
  - `is_update`/`update_type` on `EmailExtractionModel` → `events.last_update_type`.
  - `migrations/phase1_dedup_migration.sql`: `message_id`, `deadline_history`,
    `last_update_type`, partial unique index `(user_id, message_id)`.
- **Ran the migration** (Supabase SQL Editor) and **applied cleanup**
  (`scripts/cleanup_duplicates.py --apply`): removed 7 dupes → **13 clean rows**.
- **Fixed a real bug in the cleanup script:** Qdrant filter-delete by `event_id` 400s (no
  payload index) → now deletes vectors by point ID via scroll. Purged 7 orphaned vectors
  (Qdrant 10 points, 0 orphans).

## Issues
- **Issue B (Internship re-dup):** CONFIRMED exact re-fetch (rows 9/12/15 byte-identical).
  RESOLVED by Phase 1 dedup + cleanup. Residual: 13 kept rows have `message_id = NULL` →
  next sync re-dups each recent one once; re-run cleanup after next sync, then permanently
  idempotent.
- **Issue A (Ask KRNL deadlines):** `query.py` builds LLM context from only display_name +
  body chunk, dropping the structured `deadline`/`venue` that `hybrid_retrieval` returns.
  Still OPEN; fix after deadline work.
- **"Only Internship syncs on re-sync":** explained — incremental `date_gte(last_synced_at)`
  window only pulls same-day mail; Internship was the one email dated today.

## Decisions / planning
- Approved design for **deadline-extension intelligence on real Redis sync**
  ([spec](../specs/2026-06-22-deadline-extension-sync-design.md)): Docker Redis (env-driven,
  deploy-clean) + Celery worker; auto-apply forward-only deadline merge logged to
  `deadline_history`; matching via embedding shortlist + LLM confirm; extension email shown
  in inbox with no deadline; frontend badge.
- **Standing rules set:** no AI/model references anywhere (incl. commits); minimal code;
  track dev/test additions in [PRODUCTION_CLEANUP.md](../PRODUCTION_CLEANUP.md).
- **Repo reorganized:** docs moved under `docs/`, SQL into `backend/migrations/`,
  `PROJECT_LOG.md` added at root as the master tracker, design zip untracked.

## How to proceed
See [PROJECT_LOG.md](../../PROJECT_LOG.md) → "How to proceed". Next: Redis + worker up,
build `event_merge.py`, real 15-email sync test.
