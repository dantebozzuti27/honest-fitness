-- Add updated_at column to workouts table if it doesn't exist
-- Run this in your Supabase SQL editor

-- Create trigger function first (if it doesn't exist)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at column to workouts table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workouts' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE workouts ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Create trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_workouts_updated_at ON workouts;
CREATE TRIGGER update_workouts_updated_at
  BEFORE UPDATE ON workouts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Ensure created_at exists (should already exist, but just in case)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workouts' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE workouts ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

