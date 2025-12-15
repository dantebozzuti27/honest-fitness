-- Add username and profile_picture columns to user_preferences table
-- Run this in your Supabase SQL editor

-- Add username column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_preferences' AND column_name = 'username'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN username TEXT;
  END IF;
END $$;

-- Add profile_picture column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_preferences' AND column_name = 'profile_picture'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN profile_picture TEXT;
  END IF;
END $$;

-- Create unique index on username (if not exists)
CREATE UNIQUE INDEX IF NOT EXISTS user_preferences_username_unique 
ON user_preferences(username) 
WHERE username IS NOT NULL;

