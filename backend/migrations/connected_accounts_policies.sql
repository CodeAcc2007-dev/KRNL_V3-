-- Migration: Enable Row Level Security and add policies for connected_accounts table
-- Run this in the Supabase SQL Editor if you want to support direct client-side DB interactions

-- Enable Row Level Security (RLS)
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;

-- Select policy: Users can only read their own connected accounts
DROP POLICY IF EXISTS "Allow users to read their own connected accounts" ON connected_accounts;
CREATE POLICY "Allow users to read their own connected accounts" 
ON connected_accounts FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

-- Insert policy: Users can only insert their own connected accounts
DROP POLICY IF EXISTS "Allow users to insert their own connected accounts" ON connected_accounts;
CREATE POLICY "Allow users to insert their own connected accounts" 
ON connected_accounts FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

-- Update policy: Users can only update their own connected accounts
DROP POLICY IF EXISTS "Allow users to update their own connected accounts" ON connected_accounts;
CREATE POLICY "Allow users to update their own connected accounts" 
ON connected_accounts FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Delete policy: Users can delete their own connected accounts
DROP POLICY IF EXISTS "Allow users to delete their own connected accounts" ON connected_accounts;
CREATE POLICY "Allow users to delete their own connected accounts" 
ON connected_accounts FOR DELETE 
TO authenticated 
USING (auth.uid() = user_id);
