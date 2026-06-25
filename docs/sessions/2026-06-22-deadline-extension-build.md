# Session — 2026-06-22 · Deadline-extension build (subagent-driven)

Executed `docs/plans/2026-06-22-deadline-extension-sync.md` via subagent-driven development
(fresh subagent per task, controller reviewed each diff inline, cheap models for
transcription tasks).

## Done (code complete, reviewed inline)
- **Task 2** `event_merge.py` — `parse_deadline`, `should_apply_extension` (forward-only). 3 tests.
- **Task 3** — `confirm_same_event` (Gemini yes/no) + `find_matching_event` (Qdrant shortlist
  → active events → confirm). 3 tests.
- **Task 4** — `apply_extension` (move deadline forward, append `deadline_history`). 1 test.
- **Task 5** — wired the merge into `sync_task` (matched update emails update the original
  event; the update email is inserted with `deadline = None`).
- **Task 6** — `EventResponse` + all three `events.py` constructors expose `deadline_history`
  / `last_update_type`.
- **Task 7** — DeadlinesScreen "Deadline extended" badge.
- **Task 8** — InboxScreen "Update" tag.
- 18 backend unit tests green throughout.

## Finding: Qdrant client timeout (fixed)
The Qdrant health-check surfaced intermittent `SSL handshake / operation timed out`. The
cloud instance (eu-west-1) responds in up to ~19s from here; the client in `ingestion.py`
had no explicit timeout. With `timeout=60`, 5/5 queries succeeded. Applied the one-line fix
(commit fc9530c). This is very likely the main cause of Issue A ("Ask KRNL not working
fine") — more than the context-dropping bug.

## Pending (env-blocked)
- **Docker is not installed** on this machine → the live 10–15 email E2E (plan Task 9) and
  starting `docker-compose.yml` can't run here. `qdrant_healthcheck.py` was written and runs
  (no Redis needed). Next: install Docker/native Redis, start the worker, run the E2E.

## How to proceed
See [PROJECT_LOG.md](../../PROJECT_LOG.md) → "How to proceed". After the E2E, re-run
`cleanup_duplicates.py --apply` once for the residual legacy dup, then Issue A part 1
(`query.py` deadline context).
