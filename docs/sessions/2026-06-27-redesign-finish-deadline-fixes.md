# Session 2026-06-27 — Redesign finish + deadline/extraction/merge fixes

## Summary

Finished the frontend **redesign** (Ask KRNL, Settings, Login — the last three screens) and
fixed a cluster of deadline/extraction/update-merge bugs surfaced while testing the redesigned
Deadlines screen. All work is on the **`redesign`** branch.

## Deadlines / extraction fixes

1. **Events showing as Overdue when they're today** — root cause was *data*, not logic. The
   extraction prompt never passed the email's received date, so undated emails got a guessed
   year (2024). Real 2026 events were stored as 2024 → correctly labelled "expired". The list
   also hid the year, so a 2024-06-27 row looked like today.
   - Fix: [ingestion.py](../../backend/app/services/ingestion.py) prompt now includes
     `msg_date`, anchors the year to it, and keeps a stated time.
   - UI: `shortDue` shows the year when it isn't the current year.
   - Data: corrected rows **37** (FinSearch) and **76** (Sophomore 101) 2024→2026.

2. **Phantom "5:30 AM" on every deadline** — `new Date("2026-06-27")` parses a bare date as
   UTC midnight; rendered in IST (+05:30) it shows 5:30 AM. Fixed `formatFullDate`
   ([EmailDetailScreen.tsx](../../frontend/src/app/components/EmailDetailScreen.tsx)) and
   `formatDue`/`parseDeadline` to parse by string components and show a time only when one
   actually exists.

3. **Time-aware Deadlines** — `parseDeadline` + `byTimeThenUndated` in
   [DeadlinesScreen.tsx](../../frontend/src/app/components/DeadlinesScreen.tsx): within a
   group/day, timed items sort first (chronological), undated below; the time renders in both
   the list and the calendar agenda.

4. **Event times were never stored** — the model *can* extract the time (verified live:
   "Resume Making Session" → `2026-06-28 14:00:00`), but the **`deadline` column was Postgres
   `date`**, which truncates the time on insert. Migration
   [add_deadline_time.sql](../../backend/migrations/add_deadline_time.sql) widens it to
   `timestamp without time zone` (+ backfills event 100). **Must be run manually in the
   Supabase SQL editor.** Date-only deadlines become midnight and are treated as "no time".

## Update-merge fix (duplicate events)

- **Bug:** an update email only merged into its parent event when
  `update_type == "deadline_extension"`. A **reminder** (or venue change, etc.) fell through
  and was inserted as a *new* event → "Sophomore 101 session" listed twice.
- **Fix:** [sync_task.py](../../backend/app/tasks/sync_task.py) now merges for **any**
  `is_update`. New `apply_update` in
  [event_merge.py](../../backend/app/services/event_merge.py) merges into the matched event and
  **prefers the update's date/time** when present (a reminder restating the same date is a
  no-op, compared via parsed datetimes); the update email is stored for the inbox with
  `deadline=None` so it doesn't double-list. Also fixed the matcher's "active" window
  (`dl < utcnow()` excluded same-day midnight deadlines → now date-level) so same-day events
  are still matchable.
- Data: cleared duplicate reminder row **103** (`deadline=None`).

## Redesign — completed screens (flat single-blue-accent system)

- **Ask KRNL** — header reduced to title + quiet "Synced"; empty state with tappable
  suggestion chips; **de-bubbled** answers under a `KRNL` micro-label; citations are **rich
  tappable cards** that open the **shared** `EmailDetailScreen` (new optional `direction="up"`
  slide); flat send button; removed the AI-engine wording in the error string.
- **Settings** — Apple grouped-list with hairline-divided rows; flattened all
  glows/gradients/tints; neutral avatar; flat status dots; System block trimmed to Version +
  real Last-synced (**removed the AI-model row** and other fake rows); danger-zone + modals
  re-skinned; logic untouched.
- **Login** — removed green glow/gradient/pulse; flat hairline logo with a **blue** mark; card
  dropped so the Google button stands alone; all tokens.

The redesign rollout is now **complete** (Inbox, Email Detail, Deadlines, Ask KRNL, Settings,
Login, floating nav).

## To apply before this is live

1. Run [add_deadline_time.sql](../../backend/migrations/add_deadline_time.sql) in Supabase.
2. Restart the Celery worker so the new extraction prompt + update-merge logic take effect.

## Next session

- **Improve Ask KRNL answer quality / optimization** — retrieval + answering currently give
  weak results. Look at `hybrid_retrieval`, the context/prompt in
  [query.py](../../backend/app/api/v1/endpoints/query.py), chunking, and citation grounding.

## Data mutations applied this session (for audit)

- events 37, 76: deadline year 2024 → 2026.
- event 103: deadline → NULL (duplicate reminder de-listed).
- event 100: deadline set to `2026-06-28 14:00:00` (no-op until the column migration runs).
