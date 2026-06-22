-- Migration: auto-create a profile row when a new auth user is created
-- Run AFTER supabase_migration.sql (requires inbox_tabs column to exist)
-- Run this in the Supabase SQL Editor (requires superuser / postgres role)

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, user_name, interests, roll_number, primary_department, inbox_tabs, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'IITB Student'),
    '',
    '',
    '',
    '["Important", "Opportunities", "Announcement", "Academic"]'::jsonb,
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
