# KRNL V3 — Project Log

_Single entry point. Open this first. Detail lives in [`docs/`](docs/)._

KRNL V3 = IITB student email-intelligence PWA. Backend FastAPI + Supabase (Postgres) +
Qdrant (vectors) + Redis/Celery (sync queue) + Gemini (free tier; extraction + embeddings).
Frontend Vite + React PWA. Email sync via IMAP (`imap.iitb.ac.in`), credentials encrypted
at rest.

## Where things are

| What | Path |
|---|---|
| Phased plan + progress log | [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) |
| Design specs (per feature, dated) | [docs/specs/](docs/specs/) |
| Session logs (dated context/ref) | [docs/sessions/](docs/sessions/) |
| Production-cleanup tracker | [docs/PRODUCTION_CLEANUP.md](docs/PRODUCTION_CLEANUP.md) |
| UI audit | [docs/audit/](docs/audit/) |
| DB migrations (run manually in Supabase SQL Editor) | [backend/migrations/](backend/migrations/) |
| Ops scripts | [backend/scripts/](backend/scripts/) |
| Tests | [backend/tests/](backend/tests/) |

## Status at a glance

- **Branch:** `phase-1-quota-data-integrity` (main = Initial commit, kept as rollback point).
- **Done:** Phase 0, Phase 1 (dedup, batch embeddings, is_update/update_type), duplicate
  cleanup applied.
- **Deadline-extension feature: CODE COMPLETE** (Tasks 2–8 of the plan, reviewed inline) —
  `event_merge.py` (match via Qdrant + LLM confirm; forward-only apply + `deadline_history`),
  wired into `sync_task`, API exposes new fields, frontend badge + Update tag. Plus a Qdrant
  client `timeout=60` fix (see Issue A).
- **Async sync WORKS (2026-06-22).** Redis runs locally via **podman** (`podman run -d
  --name krnl-redis --network=host redis:7-alpine` — Docker isn't installed; `--network=host`
  avoids flaky rootless port-forwarding). Celery worker:
  `cd backend && celery -A app.core.celery_app worker --concurrency=1 --loglevel=info`.
  Verified: a dispatched sync fetched 7, skipped 3 (dedup), processed 4, succeeded.
- **Fixed (commit bebf176):** Celery task registration — `autodiscover_tasks(['app.tasks'])`
  looked for nonexistent `app/tasks/tasks.py`, so the worker never registered
  `run_email_sync` (async dispatch failed "unregistered task"; sync fallback masked it).
  Now `include=['app.tasks.sync_task','app.tasks.deletion_task']`.
- **Residual dup:** that sync re-created the legacy NULL-`message_id` rows once (e.g.
  Internship) — run `cleanup_duplicates.py --apply` once more, then it's idempotent.
- **Later:** Phase 3 auto-sync (Celery Beat), Phase 4 security, Phase 5 UX polish.

## Issues tracker

| # | Issue | Status | Detail |
|---|---|---|---|
| A | Ask KRNL can't answer deadline questions | OPEN (2 causes) | (1) `query.py` drops structured `deadline` from LLM context; (2) **Qdrant client had no timeout → intermittent SSL timeouts** (fixed `timeout=60` 2026-06-22, commit fc9530c) — likely the bigger cause of "not working fine" |
| B | Internship email re-duplicates on re-sync | RESOLVED 2026-06-22 | Phase 1 message_id dedup + cleanup; see [session](docs/sessions/2026-06-22-phase1-dedup-and-planning.md) |
| — | "Full Message" collapsible shows on only 1 mail | OPEN (investigate) | DEVELOPMENT_PLAN progress log |

## How to proceed (next session)

1. Install Docker (or native Redis), then `docker compose up -d` and run the Celery worker:
   `cd backend && celery -A app.core.celery_app worker --concurrency=1 --loglevel=info`.
2. Run the live E2E (plan Task 9): clear `last_synced_at`, dispatch a 15-email sync, watch
   the worker log for dedup skips and `Applied deadline extension to event …`.
3. After that sync, run `cleanup_duplicates.py --apply` once to clear the residual legacy
   dup (NULL `message_id`).
4. Tackle Issue A part 1 (`query.py` deadline context) now that the Qdrant timeout is fixed.

## Standing rules

No AI/model references in code, comments, strings, or commits. Keep code minimal
(optimize later on request). Log every dev/test/extra addition in
[docs/PRODUCTION_CLEANUP.md](docs/PRODUCTION_CLEANUP.md).
