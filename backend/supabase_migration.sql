-- Migration to add inbox_tabs to profiles table for Phase 4
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS inbox_tabs JSONB DEFAULT '["Important", "Opportunities", "Announcement", "Academic"]'::jsonb;
