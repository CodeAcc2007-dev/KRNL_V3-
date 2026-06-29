# Production-cleanup tracker

Living checklist of everything that must NOT ship to production, or must change before
deploy. Every dev/test/extra addition gets an entry here so removal is trivial.

Columns: **what · where · why it exists · action before prod.**

## Test / dev scaffolding

| What | Where | Why | Action before prod |
|---|---|---|---|
| Unit tests | `backend/tests/` | TDD for Phase 1 helpers | Keep in repo; exclude from runtime image / not deployed |
| pytest dependency | system-wide install | run tests | Dev/CI only, not a runtime dep |
| Connection smoke test | `backend/test_connection.py` | manual env check | Remove or move to tests/ |
| Duplicate-cleanup script | `backend/scripts/cleanup_duplicates.py` | one-time/ops dedup of legacy rows | Keep as ops tool; never on a request path |
| Local Redis compose | `docker-compose.yml` | local broker for dev/testing | Prod uses managed Redis via `REDIS_URL`; compose is dev-only |
| Qdrant health-check | `backend/scripts/qdrant_healthcheck.py` | diagnostic | Keep as ops tool, not on a request path |
| Email-date backfill | `backend/scripts/backfill_email_date.py` | one-time fill of email_date for pre-migration rows | Keep as ops tool, not on a request path |
| Celery worker run cmd | manual: `celery -A app.core.celery_app worker --concurrency=1 -B` | dev/testing worker **+ embedded Beat** (`-B`) — REQUIRED for auto-sync + deletion schedules to fire; without it neither periodic task runs | Prod runs worker + beat as managed processes (beat may be a separate process) |

## Dev-only fallbacks & temp values

| What | Where | Why | Action before prod |
|---|---|---|---|
| Synchronous sync fallback | `backend/app/api/v1/endpoints/sync.py` | works without Redis in dev | Once Redis is the real path, make fallback dev-only or remove |
| `max_emails=3` fallback cap | `sync.py` fallback call | keep no-Redis request fast | N/A once async is the path |
| 13s Gemini throttle | `backend/app/tasks/sync_task.py` | free-tier global pacer | Tune/lower when on paid Gemini tier |
| `last_synced_at` test-clear | manual, during E2E test | force full fetch of 10–15 | Don't ship; it's a manual test step |
| `max_emails=15` test bump | manual/test trigger | test at scale | Revert to production cap |

## Security (cross-ref DEVELOPMENT_PLAN Phase 4)

| What | Where | Why | Action before prod |
|---|---|---|---|
| ~~`/sync/status` has no auth~~ | `sync.py` `get_sync_status` | left open | ✅ DONE 2026-06-29 — `Depends(get_current_user)` added |
| `/sync/trigger` rate-limit | `sync.py` + `app/core/rate_limit.py` | abuse/runaway-cost guard | ✅ DONE 2026-06-29 — 1/user/min Redis fixed-window, fail-open |
| `TEMP_ACCESS_TOKEN` | core/security (if present) | dev convenience | N/A — does not exist in `backend/app` (no-op) |
| CORS | `backend/app/main.py` | permissive in dev | Lock to real frontend origin (deploy-time `.env`) |
| Secrets in `.env` | `backend/.env` | local dev | Move to host secrets; never commit (deploy-time) |

## Mock / placeholder data

| What | Where | Why | Action before prod |
|---|---|---|---|
| Ask KRNL mock Q&A | `AskKrnlScreen.tsx` | Removed in Phase 0 — verify none linger | Remove if any traces remain |
| Hardcoded deadline fallback list | DeadlinesScreen.tsx (~lines 50-88) | shows demo data when /deadlines fails | Remove before prod or replace with empty state |
| Hardcoded inbox fallback list | InboxScreen.tsx (~lines 112-139) | shows demo data when /events fails | Remove before prod or replace with empty state |

## Dev-only mobile-testing changes (2026-06-26)

Made to test the PWA on a physical phone over the LAN. All must revert/parametrize before prod.

| What | Where | Why | Action before prod |
|---|---|---|---|
| LAN IPs in `ALLOWED_ORIGINS` | `backend/.env` (`http://192.168.10.9:5173`, `.15`) | let the phone's origin pass CORS | Lock to the real frontend origin |
| Servers bound to `0.0.0.0` | run cmds (`uvicorn --host 0.0.0.0`, `vite --host`) | reachable from phone on LAN | Prod uses managed hosting / real domain |
| `VITE_API_URL=http://192.168.10.9:8000` | frontend dev run env | phone hits API over LAN, not `localhost` | Set to real API URL via env |
| Supabase **Site URL** = `http://192.168.10.9:5173` | Supabase dashboard → Auth → URL Config | OAuth redirect lands back on the phone origin | Revert to real domain; keep only prod redirect URLs |
| Supabase redirect URLs for LAN IPs | Supabase dashboard | allow OAuth round-trip on LAN | Remove LAN entries before prod |

_Add new rows here as work proceeds._
