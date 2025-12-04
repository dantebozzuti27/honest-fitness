-- Add nutrition_settings and weekly_meal_plan columns to user_preferences table
-- Run this in your Supabase SQL editor

-- Create user_preferences table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  age INTEGER,
  weight NUMERIC,
  height NUMERIC,
  goals JSONB,
  preferences JSONB,
  nutrition_settings JSONB,
  weekly_meal_plan JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Add nutrition_settings column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_preferences' AND column_name = 'nutrition_settings'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN nutrition_settings JSONB;
  END IF;
END $$;

-- Add weekly_meal_plan column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_preferences' AND column_name = 'weekly_meal_plan'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN weekly_meal_plan JSONB;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own preferences
-- Drop existing policies if they exist, then create them
DROP POLICY IF EXISTS "Users can view own user_preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can insert own user_preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can update own user_preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can delete own user_preferences" ON user_preferences;

CREATE POLICY "Users can view own user_preferences" ON user_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own user_preferences" ON user_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own user_preferences" ON user_preferences
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own user_preferences" ON user_preferences
  FOR DELETE USING (auth.uid() = user_id);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);

