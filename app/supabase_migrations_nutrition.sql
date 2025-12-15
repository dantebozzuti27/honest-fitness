-- Add nutrition/meals columns to daily_metrics table
-- Run this in your Supabase SQL editor

-- Add meals and macros columns if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_metrics' AND column_name = 'meals'
  ) THEN
    ALTER TABLE daily_metrics ADD COLUMN meals JSONB;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_metrics' AND column_name = 'macros'
  ) THEN
    ALTER TABLE daily_metrics ADD COLUMN macros JSONB;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_metrics' AND column_name = 'water'
  ) THEN
    ALTER TABLE daily_metrics ADD COLUMN water NUMERIC DEFAULT 0;
  END IF;
END $$;

-- Optional: if you're using the newer unified `health_metrics` table, add micronutrients rollup column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'health_metrics'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'health_metrics' AND column_name = 'micros'
    ) THEN
      ALTER TABLE health_metrics ADD COLUMN micros JSONB;
    END IF;
  END IF;
END $$;

