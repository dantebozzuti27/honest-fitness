-- ============================================================================
-- MIGRATION: Unique Constraints for User Data
-- Purpose: Ensure only one phone number, email, and username per account
-- ============================================================================

-- Create user_profiles table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT,
  phone_number TEXT,
  display_name TEXT,
  bio TEXT,
  profile_picture TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can view public user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can insert own user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can delete own user_profiles" ON user_profiles;

-- RLS Policies
CREATE POLICY "Users can view own user_profiles" ON user_profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view public user_profiles" ON user_profiles
  FOR SELECT USING (true); -- Allow viewing for friend search

CREATE POLICY "Users can insert own user_profiles" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own user_profiles" ON user_profiles
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own user_profiles" ON user_profiles
  FOR DELETE USING (auth.uid() = user_id);

-- Create unique constraint on username (case-insensitive)
-- First, create a function to normalize usernames
CREATE OR REPLACE FUNCTION normalize_username(username TEXT)
RETURNS TEXT AS $$
BEGIN
  IF username IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN LOWER(TRIM(username));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create unique index on normalized username
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_username_unique 
ON user_profiles(normalize_username(username)) 
WHERE username IS NOT NULL AND username != '';

-- Create unique constraint on phone_number (normalized - digits only)
-- First, create a function to normalize phone numbers
CREATE OR REPLACE FUNCTION normalize_phone(phone TEXT)
RETURNS TEXT AS $$
BEGIN
  IF phone IS NULL THEN
    RETURN NULL;
  END IF;
  -- Remove all non-digit characters
  RETURN regexp_replace(phone, '[^0-9]', '', 'g');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create unique index on normalized phone number
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_phone_unique 
ON user_profiles(normalize_phone(phone_number)) 
WHERE phone_number IS NOT NULL AND phone_number != '';

-- Note: Email uniqueness is already enforced by auth.users table
-- But we can add a trigger to ensure email is unique across the system
-- Create a function to check email uniqueness
CREATE OR REPLACE FUNCTION check_email_uniqueness()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if email already exists in auth.users (this is handled by Supabase Auth)
  -- We just need to ensure no duplicate emails in user_profiles if we add email there
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_user_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_profiles_updated_at ON user_profiles;
CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_user_profiles_updated_at();

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles(username) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_profiles_phone ON user_profiles(phone_number) WHERE phone_number IS NOT NULL;

