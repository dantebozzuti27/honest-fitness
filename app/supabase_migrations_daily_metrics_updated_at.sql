-- Add updated_at, resting_heart_rate, body_temp, calories_consumed, and calories_burned columns to daily_metrics table if they don't exist
-- Run this in your Supabase SQL editor

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_metrics' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE daily_metrics ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_metrics' AND column_name = 'resting_heart_rate'
  ) THEN
    ALTER TABLE daily_metrics ADD COLUMN resting_heart_rate NUMERIC;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_metrics' AND column_name = 'body_temp'
  ) THEN
    ALTER TABLE daily_metrics ADD COLUMN body_temp NUMERIC;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_metrics' AND column_name = 'calories_consumed'
  ) THEN
    ALTER TABLE daily_metrics ADD COLUMN calories_consumed NUMERIC;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_metrics' AND column_name = 'calories_burned'
  ) THEN
    ALTER TABLE daily_metrics ADD COLUMN calories_burned NUMERIC;
  END IF;
END $$;
