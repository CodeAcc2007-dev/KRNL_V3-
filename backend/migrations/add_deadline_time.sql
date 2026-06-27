-- Allow event deadlines to carry a time-of-day.
--
-- The `deadline` column was `date`, so any time component extracted from an
-- email (e.g. "Time: 2:00 PM") was silently truncated on insert. Widen it to a
-- naive `timestamp` (no time zone) so the extracted local wall-clock time is
-- preserved exactly. Date-only deadlines become midnight and the app already
-- treats a 00:00 time as "no time", so nothing else changes.

ALTER TABLE events
  ALTER COLUMN deadline TYPE timestamp without time zone
  USING deadline::timestamp without time zone;

-- Backfill the recently synced "Resume Making Session" (its email stated
-- "Date: 28th June 2026 / Time: 2:00 PM onwards"). Guarded so it only touches
-- that still-untimed row.
UPDATE events
  SET deadline = '2026-06-28 14:00:00'
  WHERE id = 100 AND deadline = '2026-06-28'::timestamp;
