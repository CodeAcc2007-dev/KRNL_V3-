# Deadline-extension intelligence on real Redis sync — Design

_Date: 2026-06-22_

## Goal

Run the email sync for real on Redis/Celery (10–15 messages per run instead of the
3-email dev fallback), and add deadline-extension intelligence: when an email updates an
event you already have, move the original event's deadline forward and still show the
update email in the inbox.

This combines **Phase 2** (stand up Redis/Celery) and **Phase 1.5** (deadline-extension
merge) from `DEVELOPMENT_PLAN.md`. Phase 1 dedup (`message_id`, batch embeddings,
`is_update`/`update_type`) is already done and is a prerequisite.

## Standing constraints (apply to all work here)

- **No AI/model references** in code, comments, user-facing strings, or commit messages.
- **Minimal code** — smallest change that works; no speculative abstractions. Optimization
  is deferred to a later, user-initiated pass.
- **Track dev/test/extra additions** in `PRODUCTION_CLEANUP.md` (where / why / what).

## Section 1 — Data model & decision flow

Per fetched email, the sync task does, in order:

1. **Dedup check** (already built): compute `message_id`; if already ingested for this user
   → skip and continue to the next message.
2. **Extract** via Gemini (already emits `display_name`, `deadline`, `is_update`,
   `update_type`, …).
3. **Branch:**
   - **Not an update** (`is_update == false`) → insert a normal event row (current behavior).
   - **Update with a deadline** → run **matching** (Section 1a). Then:
     - **Match found AND new deadline is strictly later than the current** (forward-only)
       → mutate the ORIGINAL event: set `deadline = new`, append
       `{old, new, at, message_id}` to `deadline_history`, set
       `last_update_type = update_type`. Insert the update email as its own inbox row with
       `deadline = NULL` (visible in Inbox, absent from Deadlines).
     - **No confident match** → treat as a normal new event (keeps its own deadline).
     - **Match found but new deadline not later** → no mutation; still insert the email row
       with `deadline = NULL` so it is visible in the inbox.

### Section 1a — Matching (`app/services/event_merge.py`)

- `find_matching_event(user_id, email_text, extracted) -> Optional[dict]`:
  1. Embed the update email (reuse `generate_embeddings`).
  2. Qdrant vector search of `krnl_email_chunks` filtered by `user_id` → top candidate
     `event_id`s (limit ~3).
  3. Fetch those events from Supabase; keep only **active** ones (deadline present and not
     in the past).
  4. Ask Gemini a yes/no: "does this email update this event?" for the top candidate.
     Return it on `yes`, else `None`.
- `should_apply_extension(current_deadline, new_deadline) -> bool`: pure — true only when
  both parse and `new > current` (forward-only guard). **Unit-tested.**
- `apply_extension(event, new_deadline, update_type, message_id)`: performs the Supabase
  update described above.

The pure decision/parse helpers are unit-tested; Qdrant/LLM calls are mocked in tests.

## Section 2 — Infra (Redis + Celery), deploy-clean

- Minimal `docker-compose.yml` with a single `redis:7-alpine` service mapped to
  `6379:6379`. No extra services, no bloat.
- `REDIS_URL` stays env-driven: dev → `redis://localhost:6379/0`; deploy → set the env var
  to a cloud `rediss://` broker. No code change.
- Worker run command (documented, not auto-started in prod here):
  `celery -A app.core.celery_app worker --concurrency=1`. The `concurrency=1` global Gemini
  throttle is retained.
- With Redis + worker up, `/sync/trigger`'s async path runs for real; the synchronous
  3-email fallback only fires when the broker is unreachable.

## Section 3 — Getting 10–15 to sync for the test

The incremental `date_gte(last_synced_at)` window is why only same-day mail is fetched. For
the end-to-end test we **clear `last_synced_at` once** (forces a full `ALL` fetch) and run
the sync with `max_emails=15`. Afterward, normal incremental + dedup resumes. Both the
`last_synced_at` clear and the `15` bump are logged in `PRODUCTION_CLEANUP.md`.

## Section 4 — Frontend

- `EventResponse` (and the screens) gain `deadline_history` and `last_update_type`.
- **DeadlinesScreen:** show a "Deadline extended: <old> → <new>" badge on events whose
  `deadline_history` is non-empty.
- **InboxScreen:** small "Update" tag on rows where `last_update_type` is set. Null-deadline
  update rows naturally don't appear in Deadlines.

## Section 5 — Testing & verification

- **Unit tests:** forward-only guard, deadline parse/compare, match-selection logic
  (Qdrant/LLM mocked).
- **Qdrant health check:** confirm vector search returns candidates for a known event —
  de-risks the matching step and the separately-tracked Ask KRNL retrieval concern.
- **End-to-end:** Redis + worker up → clear `last_synced_at` → trigger a 15-email sync →
  observe dedup skips and a deadline extension merging into its original event with the
  badge rendered.

## Section 6 — Production-cleanup tracker

Create `PRODUCTION_CLEANUP.md` at the repo root, a living checklist of everything that must
not ship to production, each with **what / where / why / action before prod**. Seed entries:

- Test code: `backend/tests/`, pytest dep, `backend/test_connection.py`.
- Ops scripts: `backend/scripts/cleanup_duplicates.py`.
- Dev-only fallbacks: synchronous sync fallback in `sync.py`; `max_emails=3` cap;
  temporary `max_emails=15` test bump.
- Hardcoded/temp: `TEMP_ACCESS_TOKEN`, any test user IDs, the `13s` throttle constant, the
  `last_synced_at` test-clear.
- Mock/placeholder: verify none linger (Phase 0 removed Ask KRNL mock Q&A).
- Security (cross-ref Phase 4): `/sync/status` auth, CORS lock-down, secrets via host env.

## Out of scope

- Ask KRNL deadline-answer fix (Issue A) — deferred, tracked separately.
- Non-deadline update types (venue change, cancellation) — `update_type` is captured but
  only `deadline_extension` mutates an event in this iteration.
- Celery Beat auto-sync (Phase 3) and full security hardening (Phase 4).
