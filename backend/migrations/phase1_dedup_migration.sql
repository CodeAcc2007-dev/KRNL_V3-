-- Phase 1 migration: quota & data integrity
-- Run this in the Supabase SQL Editor.
--
-- Adds the dedup key + fields that Phase 1.5 (deadline-extension intelligence)
-- will build on. Idempotent: safe to re-run.

-- 1. Stable per-email identifier (RFC Message-ID, or uid: fallback).
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS message_id text;

-- 2. Deadline-history + last-update-type for Phase 1.5 / UI badge.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS deadline_history jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS last_update_type text;

-- 3. Idempotent re-syncs: one event row per (user, email).
--    Existing rows have message_id = NULL; Postgres treats NULLs as distinct,
--    so this unique index does NOT conflict with the legacy duplicate rows.
--    Clean those up separately with scripts/cleanup_duplicates.py.
CREATE UNIQUE INDEX IF NOT EXISTS events_user_message_id_unique
  ON events (user_id, message_id)
  WHERE message_id IS NOT NULL;
