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
| Architecture decision records | [docs/decisions/](docs/decisions/) |
| Sync flow + performance analysis | [docs/sync-flow.md](docs/sync-flow.md), [docs/sync-performance.md](docs/sync-performance.md) |
| **Gemini rate limits & capacity** | [docs/gemini-rate-limits.md](docs/gemini-rate-limits.md) |
| Session logs (dated context/ref) | [docs/sessions/](docs/sessions/) |
| Production-cleanup tracker (dev scaffolding to remove) | [docs/PRODUCTION_CLEANUP.md](docs/PRODUCTION_CLEANUP.md) |
| **Debloat / production-readiness audit (cross-session, YAGNI)** | [docs/PRODUCTION_READINESS_AUDIT.md](docs/PRODUCTION_READINESS_AUDIT.md) |
| UI audit | [docs/audit/](docs/audit/) |
| DB migrations (run manually in Supabase SQL Editor) | [backend/migrations/](backend/migrations/) |
| Ops scripts | [backend/scripts/](backend/scripts/) |
| Tests | [backend/tests/](backend/tests/) |

## Status at a glance

- **2026-06-30 — Interests & priority redesign SHIPPED (branch `redesign`, subagent-driven).** Session log:
  [docs/sessions/2026-06-30-interests-priority-redesign.md](docs/sessions/2026-06-30-interests-priority-redesign.md).
  Also: deployment strategy (Oracle Free VM / Hostinger VPS / Railway) + promo brief drafted. Open bug: "page not loading properly" (deferred).
  Spec + plan in [docs/superpowers/](docs/superpowers/). DB-backed `interest_catalog` (11 seed fields)
  feeds both extraction and a new Settings/onboarding multi-select; extraction tags each email
  (`events.interest_tags`); `calculate_priority` is now a relevance-led blend
  (`0.4·importance + 0.6·relevance`, importance-only fallback) with shared `IMPORTANT_THRESHOLD=60`
  driving the Important tab (and future notifications). **Action needed:** run
  [interests_priority_migration.sql](backend/migrations/interests_priority_migration.sql) in Supabase
  (catalog table + `interest_tags`/`interest_slugs` columns) — until then the feature degrades safely
  (priority falls back to importance-only). Deferred (see PRODUCTION_CLEANUP): `res.ok` hardening on the
  interest-save POST; rewording a pre-existing AI-reference fallback string. Notifications design is
  parked behind this (triggers/threshold now read the new priority). **Next:** apply migration → notifications → deploy.
- **2026-06-29 — Phase 3/4 + full debloat + PWA fixes; notifications design in progress.** See
  [session log](docs/sessions/2026-06-29-debloat-autosync-pwa-notifications.md). Done: Phase 4 security
  (auth + rate-limit), Phase 3 auto-sync Beat (15-min, throttle 6s), **debloat finished** (frontend
  8,552→~3,400 ln, deps 57→4; tracker `docs/PRODUCTION_READINESS_AUDIT.md`), new icon, Settings install
  button, **installed-PWA auth fix (PKCE + manifest scope/id)**, **deploy-safe service worker (fixed
  black screen)**. Android PWA verified working over a dev HTTPS cloudflared tunnel (ephemeral; revert
  per PRODUCTION_CLEANUP). **Next:** finish notifications (Web Push) design → build → **deployment**.
- **2026-06-27 — Redesign COMPLETE + deadline/extraction/merge fixes.** See
  [session log](docs/sessions/2026-06-27-redesign-finish-deadline-fixes.md). Active branch:
  **`redesign`**; old look preserved on **`pre-redesign-backup`**. All screens redesigned
  (Inbox, Email Detail, Deadlines, Ask KRNL, Settings, Login, floating nav) on the flat
  single-blue-accent system. Also fixed: wrong-year extraction (anchor to `msg_date`),
  phantom 5:30 AM, time-aware Deadlines sorting/display, and duplicate events from
  reminder-type updates (`apply_update` merges all `is_update` types).
  **Action needed:** run [add_deadline_time.sql](backend/migrations/add_deadline_time.sql)
  in Supabase (deadline `date`→`timestamp`, so event times persist) **and** restart the
  Celery worker. **Next session:** improve Ask KRNL answer quality (retrieval + prompt).
- **2026-06-26 — earlier work** (bugfixes, mobile bring-up, redesign start) in its
  [session log](docs/sessions/2026-06-26-bugfixes-mobile-redesign.md). Dev-only
  mobile/LAN/OAuth changes logged in PRODUCTION_CLEANUP.md.
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
- **Fixed 2026-06-25:** a second, separate Celery bug — `sync_task.py` and
  `deletion_task.py` used the generic `@shared_task` decorator, which resolves to
  Celery's built-in default app (AMQP/RabbitMQ broker) when nothing else is bound,
  _not_ the project's Redis-configured `celery_app`. `.delay()` always failed
  (`Connection refused` to RabbitMQ) and silently fell back to the synchronous
  `max_emails=3` path — this is why Sync Now only ever returned 3 emails instead of 10.
  Fix: bind both tasks explicitly via `@celery_app.task(...)`. Verified end-to-end:
  worker now processes the full `max_emails=10` default.
- **Resolved 2026-06-25 (see Issue C):** switched Gemini model to `gemini-3.1-flash-lite`
  (500 RPD) across all 3 call sites — see [gemini-rate-limits.md](docs/gemini-rate-limits.md).
- **Residual dup:** that sync re-created the legacy NULL-`message_id` rows once (e.g.
  Internship) — run `cleanup_duplicates.py --apply` once more, then it's idempotent.
- **Later:** Phase 3 auto-sync (Celery Beat), Phase 4 security, Phase 5 UX polish.

## Issues tracker

| # | Issue | Status | Detail |
|---|---|---|---|
| A | Ask KRNL can't answer deadline questions | OPEN (2 causes) | (1) `query.py` drops structured `deadline` from LLM context; (2) **Qdrant client had no timeout → intermittent SSL timeouts** (fixed `timeout=60` 2026-06-22, commit fc9530c) — likely the bigger cause of "not working fine" |
| B | Internship email re-duplicates on re-sync | RESOLVED 2026-06-22 | Phase 1 message_id dedup + cleanup; see [session](docs/sessions/2026-06-22-phase1-dedup-and-planning.md) |
| — | "Full Message" collapsible shows on only 1 mail | OPEN (investigate) | DEVELOPMENT_PLAN progress log |
| C | Most emails store as "General / Failed to run AI feature extraction" | RESOLVED 2026-06-25 | **Gemini 2.5 Flash free tier = 20 calls/DAY** → 429; 35/53 events failed. Fixed by switching to `gemini-3.1-flash-lite` (500 RPD), same free key. Open flaw still standing: failed extractions are stored + dedup'd so never retried — only matters if 500 RPD is ever exceeded. See [gemini-rate-limits.md](docs/gemini-rate-limits.md) |
| D | Inbox hid most events | RESOLVED 2026-06-23 (commit c74e58e) | tabs matched 4 category names; 39/53 are "General" → added default "All" tab |
| E | Sync Now only returned 3 emails, not 10 | RESOLVED 2026-06-25 | `@shared_task` resolved to Celery's default app (RabbitMQ), not the Redis `celery_app` — `.delay()` always failed and fell back to the hardcoded 3-email sync path. Fixed by binding via `@celery_app.task(...)` |
| F | Deadlines view: future events showing as "expired"; cards not clickable | RESOLVED 2026-06-25 | `get_urgency_label` compared full datetime, so same-day deadlines stored at midnight read as already-past. Fixed to compare by date. Cards now open the in-app email detail view; titles wrap to 2 lines instead of truncating |

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
