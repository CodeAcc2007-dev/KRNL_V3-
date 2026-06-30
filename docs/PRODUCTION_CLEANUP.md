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

## Dev-only HTTPS tunnel for phone testing (2026-06-29)

To test PWA install + notifications on a physical phone (both require a secure HTTPS context),
two `cloudflared` quick tunnels expose the local frontend + backend over HTTPS. **All revert before prod**
(prod uses a real domain + HTTPS host). Tunnel URLs are **ephemeral** — they change every cloudflared
restart, so the values below are placeholders for whatever the current session generated.

| What | Where | Why | Action before prod |
|---|---|---|---|
| `cloudflared` binary | `~/.local/bin/cloudflared` | local HTTPS tunnels (frontend :4173 + backend :8000) | Dev tool only; not part of the app |
| `VITE_API_URL` = backend tunnel URL | `frontend/.env` (gitignored) | HTTPS page must call HTTPS API (no mixed content) | Set to real API URL; gitignored so never committed |
| frontend tunnel URL in `ALLOWED_ORIGINS` | `backend/.env` (gitignored) | CORS for the cross-origin tunnel pair | Lock to real frontend origin; gitignored |
| frontend served via `vite preview` (prod build) | manual (:4173) | SW registers only in PROD build → needed for install/push | Prod serves static `dist/` from a real host |
| `--http-host-header localhost:4173` on the frontend tunnel | cloudflared flag | vite 6 preview blocks unknown Host headers | N/A — dev tunnel only |
| Supabase **Site URL / redirect** = frontend tunnel URL | Supabase dashboard → Auth → URL Config | Google OAuth must redirect back to the tunnel origin | **Remove the tunnel URL**; keep only the real prod domain |

Note: nothing tunnel-specific is committed — both `.env` files are gitignored, so deploys are unaffected.
The only external state is the Supabase dashboard URL entry, which must be cleaned up manually.

## Interests & priority redesign (2026-06-30)

Catalog-backed interests + relevance-led priority. Spec/plan in `docs/superpowers/`.

| What | Where | Why | Action before prod |
|---|---|---|---|
| **Manual migration REQUIRED** | `backend/migrations/interests_priority_migration.sql` | creates `interest_catalog` (+11 seed rows) and adds `events.interest_tags` / `profiles.interest_slugs` | **Run in Supabase SQL Editor before this feature works in any environment.** Until applied: catalog endpoint returns `[]`, extraction stores no interest_tags, priority falls back to importance-only (safe, no crash) |
| `toggleInterest` POST not checking `res.ok` | `SettingsScreen.tsx` (+ same pattern in `OnboardingInterests.tsx`) | optimistic save; brief-prescribed try/catch only | Hardening pass: check `res.ok`, revert/notify on failure (low risk — self-corrects on next mount) |
| ~~Pre-existing AI-reference string~~ | `backend/app/services/ingestion.py` extraction fallback `raw_summary` | violated no-AI-refs rule | ✅ DONE 2026-06-30 — reworded to "Could not extract details from this email." |

## Web Push notifications (2026-07-01)

Spec/plan in `docs/superpowers/`. Shipped on `redesign`.

| What | Where | Why | Action before prod |
|---|---|---|---|
| **Manual migration REQUIRED** | `backend/migrations/notifications_migration.sql` | `push_subscriptions` table + `events.notified_at` / `events.deadline_reminded` + `profiles.notification_prefs` | Applied 2026-07-01 in dev Supabase. **Re-run in the production project before deploy.** Until applied the feature degrades safely (no crash; `send_to_user` no-ops) |
| **`pywebpush` runtime dependency** | `python3 -m pip install --user pywebpush` (no requirements file exists yet) | Web Push delivery + VAPID | This IS a runtime dep (unlike pytest). When a deploy manifest is created, add `pywebpush` (pulls `py-vapid`, `http-ece`) |
| **VAPID keys in `.env`** | `backend/.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) | sign Web Push; private key is a secret | Generate a fresh pair for prod via `backend/scripts/gen_vapid_keys.py`; move to host secrets; never commit. `VAPID_SUBJECT` currently `mailto:praneshbandiya@gmail.com` |
| Beat schedule needs `-B` worker | `celery -A app.core.celery_app worker -B` | hourly deadline reminders + Sun-18:00-IST digest only fire with embedded Beat | Same as auto-sync: prod runs worker+beat as managed processes |
| Settings badge style duplicated ×4 | `SettingsScreen.tsx` notification rows | review Minor (deferred) | Optional cleanup: extract a `badgeStyle(active)` helper |
| Two Supabase service clients | `sync_task.py` builds its own `create_client`; `notify_task.py` reuses `app.core.security.supabase` | pre-existing inconsistency surfaced during review | Optional consistency cleanup: unify on the shared client |

_Add new rows here as work proceeds._
