-- Store each email's actual sent date so the inbox can sort newest-first.
-- (created_at is ingest time, which no longer matches email recency now that
-- the sync backfills older mail.) Run in the Supabase SQL Editor. Idempotent.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS email_date timestamptz;
