-- Table to store pending deletion requests with a 24-hour grace period
CREATE TABLE IF NOT EXISTS deletion_requests (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    due_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security (RLS)
ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;

-- Select policy: Users can only read their own deletion request
CREATE POLICY "Allow users to read their own deletion request" 
ON deletion_requests FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

-- Insert policy: Users can only insert their own deletion request
CREATE POLICY "Allow users to request their own deletion" 
ON deletion_requests FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

-- Delete policy: Users can cancel their own deletion request
CREATE POLICY "Allow users to cancel their own deletion" 
ON deletion_requests FOR DELETE 
TO authenticated 
USING (auth.uid() = user_id);
